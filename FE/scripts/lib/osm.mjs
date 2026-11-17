// OSM 원자료(scripts/data/osm-dongtan.json)에서 지도에 쓰는 도형을 꺼냅니다(build-iso.mjs).
// 지도 데이터 © OpenStreetMap 기여자 (ODbL)
import { readFileSync } from 'node:fs';
import * as turf from '@turf/turf';

const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;

/** 여러 조각으로 나뉜 way를 이어 닫힌 링으로 만듭니다. */
function joinRings(segments) {
  const pool = segments.map((s) => [...s]);
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat([...s].reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}
const toCoords = (ring) => ring.map((p) => [p.lon, p.lat]);

/** 면 요소 → GeoJSON Polygon/MultiPolygon (구멍 포함) */
export function areaGeometry(e) {
  if (e.type === 'way') {
    if (!e.geometry || !same(e.geometry[0], e.geometry[e.geometry.length - 1])) return null;
    return { type: 'Polygon', coordinates: [toCoords(e.geometry)] };
  }
  if (e.type === 'relation') {
    const outer = joinRings(e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry));
    const inner = joinRings(e.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry));
    if (!outer.length) return null;
    const polys = outer.map((o) => {
      const op = turf.polygon([toCoords(o)]);
      const holes = inner.filter((i) => turf.booleanPointInPolygon(turf.point([i[0].lon, i[0].lat]), op)).map(toCoords);
      return [toCoords(o), ...holes];
    });
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

/** B: 공원 그림 범위(content.park.bounds). 돌려주는 값의 면은 GeoJSON 도형, 선은 OSM way(geometry: {lat, lon}[]). */
export function loadPark(root, B) {
  const { elements, fetchedAt, bbox } = JSON.parse(readFileSync(new URL('scripts/data/osm-dongtan.json', root), 'utf8'));
  const tagged = elements.filter((e) => e.tags);
  const areas = (pred) => tagged.filter(pred).map(areaGeometry).filter(Boolean);
  const lines = (pred) => tagged.filter((e) => e.type === 'way' && e.geometry && pred(e));

  const lakeEl = tagged.find((e) => e.tags.natural === 'water' && e.tags.name === '동탄호수');
  const overlaps = (e) => e.bounds && e.bounds.minlat < B.north && e.bounds.maxlat > B.south && e.bounds.minlon < B.east && e.bounds.maxlon > B.west;
  const parkEl = tagged.find((e) => e.type === 'relation' && e.tags.leisure === 'park' && overlaps(e) && e.members.length > 1) ?? tagged.find((e) => e.type === 'relation' && e.tags.leisure === 'park');
  const [south, west, north, east] = String(bbox).split(',').map(Number);
  return {
    fetchedAt,
    /** 받아 둔 OSM 자료의 범위(공원 그림 범위보다 조금 넓음) */
    dataBounds: { south, west, north, east },
    tagged,
    lake: areaGeometry(lakeEl),
    park: areaGeometry(parkEl),
    smallParks: areas((e) => e.tags.leisure === 'park' && e !== parkEl),
    woods: areas((e) => e.tags.natural === 'wood' || e.tags.landuse === 'forest'),
    grass: areas((e) => ['grass', 'meadow', 'recreation_ground'].includes(e.tags.landuse) || e.tags.leisure === 'garden'),
    pitches: areas((e) => e.tags.leisure === 'pitch'),
    playgrounds: areas((e) => e.tags.leisure === 'playground'),
    /** 건물: 종류(tags)에 따라 높이·색을 정합니다. */
    buildings: tagged.filter((e) => e.tags.building).map((e) => ({ geom: areaGeometry(e), tags: e.tags })).filter((b) => b.geom),
    streams: lines((e) => ['stream', 'river', 'canal'].includes(e.tags.waterway)),
    roads: lines((e) => e.tags.highway && !['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bus_stop', 'crossing', 'elevator'].includes(e.tags.highway) && !e.tags.area),
    paths: lines((e) => ['footway', 'path', 'cycleway', 'steps', 'pedestrian'].includes(e.tags.highway)),
    fountain: tagged.find((e) => e.type === 'node' && e.tags.amenity === 'fountain') ?? null,
  };
}
