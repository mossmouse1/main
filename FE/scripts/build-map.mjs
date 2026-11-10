// OSM 원자료(scripts/data/osm-dongtan.json) → 그림 지도(public/map/park-map.svg) + 구역·시설·비오톱 → public/content/v1.json
// 그림 지도는 PRD의 네 모서리 좌표에 정확히 맞춰 그립니다(경위도 등간격, 1080×1302).
// 지도 데이터 © OpenStreetMap 기여자 (ODbL)
import { readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';

const root = new URL('..', import.meta.url);
const { elements, fetchedAt } = JSON.parse(readFileSync(new URL('scripts/data/osm-dongtan.json', root), 'utf8'));
const contentUrl = new URL('public/content/v1.json', root);
const content = JSON.parse(readFileSync(contentUrl, 'utf8'));

const B = content.park.bounds;
const W = 1080;
const H = 1302;
const px = (lng, lat) => [((lng - B.west) / (B.east - B.west)) * W, ((B.north - lat) / (B.north - B.south)) * H];
const r1 = (n) => Math.round(n * 10) / 10;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ---------- OSM → 링 ----------
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
function areaGeometry(e) {
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

const tagged = elements.filter((e) => e.tags);
const areas = (pred) => tagged.filter(pred).map(areaGeometry).filter(Boolean);
const lines = (pred) => tagged.filter((e) => e.type === 'way' && e.geometry && pred(e));

const lakeEl = tagged.find((e) => e.tags.natural === 'water' && e.tags.name === '동탄호수');
const lake = areaGeometry(lakeEl);
const parkEl = tagged.find((e) => e.type === 'relation' && e.tags.leisure === 'park' && e.bounds.minlat < B.north && e.bounds.maxlat > B.south && e.bounds.minlon < B.east && e.bounds.maxlon > B.west && e.members.length > 1) ?? tagged.find((e) => e.type === 'relation' && e.tags.leisure === 'park');
const park = areaGeometry(parkEl);
const woods = areas((e) => e.tags.natural === 'wood' || e.tags.landuse === 'forest');
const grass = areas((e) => ['grass', 'meadow', 'recreation_ground'].includes(e.tags.landuse) || ['pitch', 'playground', 'garden'].includes(e.tags.leisure));
const urban = areas((e) => ['residential', 'commercial', 'industrial', 'construction', 'retail'].includes(e.tags.landuse) || e.tags.amenity === 'school');
const smallParks = areas((e) => e.tags.leisure === 'park' && e !== parkEl);
const buildings = areas((e) => e.tags.building);
const bridges = areas((e) => e.tags.man_made === 'bridge');
const streams = lines((e) => ['stream', 'river', 'canal'].includes(e.tags.waterway));
const roads = lines((e) => e.tags.highway && !['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bus_stop', 'crossing', 'elevator'].includes(e.tags.highway) && !e.tags.area);
const paths = lines((e) => ['footway', 'path', 'cycleway', 'steps', 'pedestrian'].includes(e.tags.highway));

// ---------- SVG ----------
const ringPath = (ring) => 'M' + ring.map(([lng, lat]) => px(lng, lat).map(r1).join(',')).join('L') + 'Z';
const geomPath = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((poly) => poly.map(ringPath)).join('');
const linePath = (e) => 'M' + e.geometry.map((p) => px(p.lon, p.lat).map(r1).join(',')).join('L');

const ROAD_WIDTH = { motorway: 22, motorway_link: 12, trunk: 20, primary: 18, secondary: 16, secondary_link: 10, tertiary: 13, tertiary_link: 9, residential: 8, unclassified: 8, service: 5, living_street: 7 };
const roadW = (e) => ROAD_WIDTH[e.tags.highway] ?? 6;

// 숲·공원의 나무 점
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function treeDots(geoms, spacing, rMin, rMax, avoid = []) {
  const dots = [];
  for (const g of geoms) {
    const f = turf.feature(g);
    const [minX, minY, maxX, maxY] = turf.bbox(f);
    const step = spacing / 111000;
    for (let y = minY; y < maxY; y += step) {
      for (let x = minX; x < maxX; x += step * 1.25) {
        const p = turf.point([x + (rnd() - 0.5) * step, y + (rnd() - 0.5) * step]);
        if (!turf.booleanPointInPolygon(p, f) || avoid.some((a) => turf.booleanPointInPolygon(p, a))) continue;
        const [cx, cy] = px(...p.geometry.coordinates);
        if (cx < -20 || cy < -20 || cx > W + 20 || cy > H + 20) continue;
        dots.push([r1(cx), r1(cy), r1(rMin + rnd() * (rMax - rMin))]);
      }
    }
  }
  return dots;
}
const lakeF = turf.feature(lake);
const woodDots = treeDots(woods, 14, 6, 10);
const parkDots = park ? treeDots([park], 34, 5, 8, [lakeF, ...woods.map((w) => turf.feature(w))]).filter(() => rnd() < 0.55) : [];

const lakeD = geomPath(lake);
const lakeRings = (lake.type === 'Polygon' ? [lake.coordinates] : lake.coordinates).flat().map(ringPath).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><clipPath id="lake"><path d="${lakeD}" clip-rule="evenodd" fill-rule="evenodd"/></clipPath></defs>
<rect width="${W}" height="${H}" fill="#eceae1"/>
<g fill="#e1ded3">${urban.map((g) => `<path d="${geomPath(g)}"/>`).join('')}</g>
${park ? `<path d="${geomPath(park)}" fill="#b3d989" fill-rule="evenodd"/>` : ''}
<g fill="#bcdf94">${smallParks.map((g) => `<path d="${geomPath(g)}"/>`).join('')}</g>
<g fill="#c8e6a2">${grass.map((g) => `<path d="${geomPath(g)}"/>`).join('')}</g>
<g fill="#6aad4f">${woods.map((g) => `<path d="${geomPath(g)}" fill-rule="evenodd"/>`).join('')}</g>
<g fill="#f7f6f1" stroke="#d3cfc2" stroke-width="1.4">${buildings.map((g) => `<path d="${geomPath(g)}"/>`).join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
<g stroke="#d6d2c4">${roads.map((e) => `<path d="${linePath(e)}" stroke-width="${roadW(e) + 3}"/>`).join('')}</g>
<g stroke="#ffffff">${roads.map((e) => `<path d="${linePath(e)}" stroke-width="${roadW(e)}"/>`).join('')}</g>
<g stroke="#5ab7b4">${streams.map((e) => `<path d="${linePath(e)}" stroke-width="9"/>`).join('')}</g>
</g>
<path d="${lakeD}" fill="#4fb0ae" fill-rule="evenodd"/>
<g clip-path="url(#lake)" fill="none" stroke-linejoin="round">
${[56, 34, 16].map((d) => `<path d="${lakeRings}" stroke="#bfe6df" stroke-opacity=".5" stroke-width="${2 * d + 3}"/><path d="${lakeRings}" stroke="#4fb0ae" stroke-width="${2 * d - 2}"/>`).join('\n')}
</g>
<path d="${lakeD}" fill="none" stroke="#2e8c8a" stroke-width="3" fill-rule="evenodd"/>
<g fill="#c99b6b">${bridges.map((g) => `<path d="${geomPath(g)}"/>`).join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${paths.map((e) => `<path d="${linePath(e)}" stroke="${e.tags.highway === 'cycleway' ? '#ecd49a' : '#f5ead0'}" stroke-width="${e.tags.highway === 'cycleway' ? 5 : 4}"/>`).join('')}
</g>
<g fill="#4f9a3f">${woodDots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<g fill="#3c7f33">${woodDots.filter((_, i) => i % 3 === 0).map(([x, y, r]) => `<circle cx="${r1(x + r * 0.4)}" cy="${r1(y + r * 0.3)}" r="${r1(r * 0.55)}"/>`).join('')}</g>
<g fill="#7dbd5c">${parkDots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
</svg>
`;
writeFileSync(new URL('public/map/park-map.svg', root), svg);

// ---------- 조사구역 ----------
// Z1·Z3·Z6은 실제 지형(호수·숲·공원 경계)에서, Z2는 호숫가 35m 띠로 계산합니다.
// Z4(정원·수목)·Z5(잔디·개방 공간)의 실제 경계는 공원 안내도·답사 전이라, 남은 공원 땅을 호수 중심 위도로 남북으로 나눈 임시 경계입니다.
const frame = turf.bboxPolygon([B.west, B.south, B.east, B.north]);
const clip = (g) => (g ? turf.intersect(turf.featureCollection([turf.feature(g), frame])) : null);
const minus = (a, ...bs) => bs.filter(Boolean).reduce((acc, b) => (acc ? turf.difference(turf.featureCollection([acc, b])) : null), a);
const unionAll = (fs) => fs.filter(Boolean).reduce((acc, f) => (acc ? turf.union(turf.featureCollection([acc, f])) : f), null);

const parkF = clip(park);
const z1 = clip(lake);
const lakeOuterOnly = turf.feature(lake.type === 'Polygon' ? { type: 'Polygon', coordinates: [lake.coordinates[0]] } : { type: 'MultiPolygon', coordinates: lake.coordinates.map((p) => [p[0]]) });
const z1Full = clip(lakeOuterOnly.geometry); // 섬도 Z1(수면·호소 섬)에 넣습니다.
const shore = turf.intersect(turf.featureCollection([turf.buffer(lakeOuterOnly, 35, { units: 'meters' }), parkF ?? frame]));
const z2 = minus(shore, z1Full);
const z3 = minus(unionAll(woods.map((w) => clip(w))), z1Full, z2);
const rest = minus(parkF, z1Full, z2, z3);
const lakeLat = turf.centerOfMass(z1Full).geometry.coordinates[1];
const north = turf.bboxPolygon([B.west, lakeLat, B.east, B.north]);
const south = turf.bboxPolygon([B.west, B.south, B.east, lakeLat]);
const z4 = rest && turf.intersect(turf.featureCollection([rest, north]));
const z5 = rest && turf.intersect(turf.featureCollection([rest, south]));
const z6 = minus(frame, parkF);

const zoneGeo = { Z1: z1Full, Z2: z2, Z3: z3, Z4: z4, Z5: z5, Z6: z6 };
const roundGeom = (g) => ({
  type: g.type,
  coordinates: g.type === 'Polygon' ? g.coordinates.map((r) => r.map(([x, y]) => [r6(x), r6(y)])) : g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [r6(x), r6(y)]))),
});
const derived = { Z1: false, Z2: false, Z3: false, Z4: true, Z5: true, Z6: false };
// 판정 우선순위 = 배열 순서
const order = ['Z1', 'Z2', 'Z3', 'Z5', 'Z4', 'Z6'];
/**
 * 구역 번호를 놓을 점: 지도에 점을 촘촘히 뿌려 우선순위로 구역을 판정하고,
 * 그 구역 점 중 다른 구역에서 가장 먼 점(구역 한가운데)을 고릅니다.
 * (호숫가 띠처럼 가운데가 빈 도형은 무게중심이 구멍 안에 생기기 때문)
 */
const GRID = (() => {
  const nx = 72;
  const ny = 86;
  const pts = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const lng = B.west + ((B.east - B.west) * (i + 0.5)) / nx;
      const lat = B.south + ((B.north - B.south) * (j + 0.5)) / ny;
      const owner = order.find((z) => zoneGeo[z] && turf.booleanPointInPolygon(turf.point([lng, lat]), zoneGeo[z]));
      pts.push({ lng, lat, x: (lng - B.west) * 88700, y: (lat - B.south) * 111000, owner });
    }
  }
  return pts;
})();
function labelPoint(id) {
  const mine = GRID.filter((p) => p.owner === id);
  const others = GRID.filter((p) => p.owner !== id);
  let best = null;
  const maxX = (B.east - B.west) * 88700;
  const maxY = (B.north - B.south) * 111000;
  for (const p of mine) {
    // 지도 테두리도 경계로 봅니다(가장자리에 붙지 않게).
    let d = Math.min(p.x, maxX - p.x, p.y, maxY - p.y) ** 2;
    for (const q of others) d = Math.min(d, (p.x - q.x) ** 2 + (p.y - q.y) ** 2);
    if (!best || d > best.d) best = { p, d };
  }
  if (!best) throw new Error(`${id} 라벨 점을 못 찾았어요`);
  return [r6(best.p.lat), r6(best.p.lng)];
}
content.zones = order
  .map((id) => {
    const old = content.zones.find((z) => z.id === id);
    const f = zoneGeo[id];
    if (!f) throw new Error(`${id} 도형을 만들지 못했어요`);
    return { ...old, center: labelPoint(id), geometry: roundGeom(f.geometry), placeholder: derived[id], boundary: derived[id] ? '임시(남북 분할)' : 'OSM 지형' };
  });

// ---------- 지도 위 이름(OSM에 있는 것만) ----------
const facilities = [];
const lakeLabel = turf.centerOfMass(z1Full).geometry.coordinates;
facilities.push({ name: '동탄호수', lat: r6(lakeLabel[1] + 0.0009), lng: r6(lakeLabel[0]), kind: 'water' });
for (const e of tagged) {
  const inBounds = (lat, lon) => lat > B.south && lat < B.north && lon > B.west && lon < B.east;
  if (e.type === 'node' && e.tags.name && ['fountain'].includes(e.tags.amenity) && inBounds(e.lat, e.lon)) facilities.push({ name: e.tags.name, lat: r6(e.lat), lng: r6(e.lon), kind: 'place' });
  if (e.type === 'node' && e.tags.natural === 'peak' && e.tags.name && inBounds(e.lat, e.lon)) facilities.push({ name: e.tags.name, lat: r6(e.lat), lng: r6(e.lon), kind: 'peak' });
}
// 호수 안 섬
(lake.type === 'Polygon' ? [lake.coordinates] : lake.coordinates).forEach((poly) =>
  poly.slice(1).forEach((hole) => {
    const c = turf.centerOfMass(turf.polygon([hole])).geometry.coordinates;
    facilities.push({ name: '작은 섬', lat: r6(c[1]), lng: r6(c[0]), kind: 'island' });
  }),
);
// 송방천: 지도 안 하천 선의 가운데쯤
const stream = streams.find((e) => e.tags.name);
if (stream) {
  const inside = stream.geometry.filter((p) => p.lat > B.south && p.lat < B.north && p.lon > B.west && p.lon < B.east);
  const mid = inside[Math.floor(inside.length * 0.25)];
  if (mid) facilities.push({ name: stream.tags.name, lat: r6(mid.lat), lng: r6(mid.lon), kind: 'water' });
}
content.facilities = facilities;

// 비오톱: 원자료(biotope_samples_4326.geojson) 전까지 호수 면만 DC2로 둡니다.
content.biotopes = [{ code: 'DC2', name: '경관휴양호수', year: 2024, source: '경기기후플랫폼 비오톱', geometry: roundGeom(z1Full.geometry), placeholder: true }];
content.map = {
  image: '/map/park-map.svg',
  width: W,
  height: H,
  placeholder: false,
  attribution: '지도 데이터 © OpenStreetMap 기여자',
  osmFetchedAt: fetchedAt.slice(0, 10),
  focus: [r6(lakeLabel[1]), r6(lakeLabel[0])],
};
content.placeholders = [
  ...content.placeholders.filter((p) => !/^map\.image|^zones|^facilities|^biotopes/.test(p)),
  'zones: Z1(호수)·Z2(호숫가 35m)·Z3(숲)·Z6(공원 밖)은 OSM 지형에서 계산, Z4·Z5는 공원 안내도 전 임시 남북 분할',
  'facilities: OSM에 있는 이름만(동탄호수·루나분수·태봉산·송방천·섬). 현자의 정원 등 PRD 시설은 위치 확인 후 추가',
  'biotopes: 호수 1개만 임시. biotope_samples_4326.geojson(97개)으로 교체',
];
writeFileSync(contentUrl, JSON.stringify(content, null, 2) + '\n');
console.log(`park-map.svg ${(svg.length / 1024).toFixed(0)}KB · 건물 ${buildings.length} · 도로 ${roads.length} · 산책로 ${paths.length} · 숲 ${woods.length} · 나무 점 ${woodDots.length + parkDots.length}`);
console.log('구역 중심', content.zones.map((z) => `${z.id}@${z.center.join(',')}`).join(' '));
console.log('지도 이름', facilities.map((f) => f.name).join(', '));
