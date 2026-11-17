// OSM 원자료(scripts/data/osm-dongtan.json) → 그림 지도(public/map/park-map.svg) + 구역·시설·비오톱 → public/content/v1.json
// 그림 지도는 PRD의 네 모서리 좌표에 정확히 맞춰 그립니다(경위도 등간격, 1080×1302).
// 지도 데이터 © OpenStreetMap 기여자 (ODbL)
import { createHash } from 'node:crypto';
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

// ---------- 그림 지도(SVG) ----------
// 공식 지도처럼 딱딱하지 않게: 도시는 조용히 물리고, 공원은 그림처럼 그립니다(둥근 나무, 물결, 오리, 갈대, 나무다리).
// 모양은 OSM 좌표 그대로입니다(모서리 둥글림은 1~2m 이내). 호수·길·숲의 자리는 실제와 같습니다.
// 이 지도는 생물 위치 고르기·검토 화면에서 씁니다(정확히 누르기 좋게 위에서 본 모습). 지도 홈의 블록 지도는 build-iso.mjs가 만듭니다.
const ROAD_WIDTH = { motorway: 22, motorway_link: 12, trunk: 20, primary: 18, secondary: 16, secondary_link: 10, tertiary: 13, tertiary_link: 9, residential: 8, unclassified: 8, service: 5, living_street: 7 };
const roadW = (e) => ROAD_WIDTH[e.tags.highway] ?? 6;

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const f1 = (n) => String(Math.round(n * 10) / 10);
const pt = (p) => `${f1(p[0])},${f1(p[1])}`;
const unpx = (x, y) => [B.west + (x / W) * (B.east - B.west), B.north - (y / H) * (B.north - B.south)];

/** 너무 촘촘한 점은 솎습니다(곡선이 꼬이지 않게). */
function thin(pts, min = 1.6) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    if (Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) >= min) out.push(pts[i]);
  }
  return out;
}
/** 점들을 지나는 부드러운 곡선(Catmull-Rom → 베지어). 조절점은 구간 길이의 40%를 넘지 않게 묶습니다. */
function curve(pts, closed, k = 0.85) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map(pt).join('L') + (closed ? 'Z' : '');
  const at = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = 'M' + pt(pts[0]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const lim = (vx, vy) => {
      const m = Math.hypot(vx, vy);
      const s = m > len * 0.4 ? (len * 0.4) / m : 1;
      return [vx * s, vy * s];
    };
    const v1 = lim(((p2[0] - p0[0]) / 6) * k, ((p2[1] - p0[1]) / 6) * k);
    const v2 = lim(((p3[0] - p1[0]) / 6) * k, ((p3[1] - p1[1]) / 6) * k);
    d += `C${pt([p1[0] + v1[0], p1[1] + v1[1]])} ${pt([p2[0] - v2[0], p2[1] - v2[1]])} ${pt(p2)}`;
  }
  return d + (closed ? 'Z' : '');
}
const ringD = (ring, smooth) => {
  const p = thin(ring.slice(0, -1).map(([lng, lat]) => px(lng, lat)));
  return smooth ? curve(p, true) : 'M' + p.map(pt).join('L') + 'Z';
};
const geomD = (g, smooth = false) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((poly) => poly.map((r) => ringD(r, smooth))).join('');
const linePx = (e) => e.geometry.map((q) => px(q.lon, q.lat));
const lineD = (e, smooth = true) => {
  const p = thin(linePx(e));
  return smooth ? curve(p, false) : 'M' + p.map(pt).join('L');
};

const segDist = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
const distToLines = (p, lines) => {
  let d = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) d = Math.min(d, segDist(p, l[i - 1], l[i]));
  return d;
};
const inAny = (lng, lat, feats) => feats.some((f) => turf.booleanPointInPolygon(turf.point([lng, lat]), f));

// ---- 재료 ----
const lakeF = turf.feature(lake);
const lakePolys = lake.type === 'Polygon' ? [lake.coordinates] : lake.coordinates;
const lakeRingsPx = lakePolys.flat().map((r) => r.map(([lng, lat]) => px(lng, lat)));
const lakeOuterPx = lakePolys.map((poly) => poly[0].map(([lng, lat]) => px(lng, lat)));
const inLakePx = (p) => turf.booleanPointInPolygon(turf.point(unpx(p[0], p[1])), lakeF);
const shoreDist = (p) => distToLines(p, lakeRingsPx);

const pitches = areas((e) => e.tags.leisure === 'pitch');
const playgrounds = areas((e) => e.tags.leisure === 'playground');
const shelters = areas((e) => e.tags.amenity === 'shelter');
const parkFeats = [park, ...smallParks].filter(Boolean).map((g) => turf.feature(g));
const parkBufs = parkFeats.map((f) => turf.buffer(f, 12, { units: 'meters' }));
const woodFeats = woods.map((g) => turf.feature(g));
const hardFeats = [...pitches, ...playgrounds, ...buildings].map((g) => turf.feature(g));
// 공원 안 길(산책로)과 공원 밖 보도를 나눕니다. 밖의 보도는 아주 옅게만 그립니다.
const pathsIn = paths.filter((e) => {
  const m = e.geometry[Math.floor(e.geometry.length / 2)];
  return inAny(m.lon, m.lat, parkBufs);
});
const pathsOut = paths.filter((e) => !pathsIn.includes(e));
const pathLinesPx = pathsIn.map(linePx);
const nearPath = (p, d) => distToLines(p, pathLinesPx) < d;

/** 도형 안에 간격을 두고 흩뿌린 점(같은 씨앗이면 늘 같은 자리) */
function scatter(geom, spacing, keep, ok) {
  const out = [];
  const f = turf.feature(geom);
  const [minX, minY, maxX, maxY] = turf.bbox(f);
  const step = spacing / 111000;
  for (let y = minY; y < maxY; y += step) {
    for (let x = minX; x < maxX; x += step * 1.25) {
      const lng = x + (rnd() - 0.5) * step;
      const lat = y + (rnd() - 0.5) * step;
      if (rnd() > keep) continue;
      if (!turf.booleanPointInPolygon(turf.point([lng, lat]), f)) continue;
      const p = px(lng, lat);
      if (p[0] < -10 || p[1] < -10 || p[0] > W + 10 || p[1] > H + 10) continue;
      if (ok && !ok(p, lng, lat)) continue;
      out.push(p);
    }
  }
  return out;
}

// 나무: 숲은 빽빽하게(침엽수 섞임), 공원은 길을 피해 드문드문, 주변 작은 공원도 조금
const pick = (table) => {
  const r = rnd();
  let acc = 0;
  for (const [k, w] of table) if (r < (acc += w)) return k;
  return table[table.length - 1][0];
};
const trees = [];
for (const g of woods) {
  for (const p of scatter(g, 15, 1, (q) => !inLakePx(q) && !nearPath(q, 4))) trees.push({ p, k: pick([['e', 0.34], ['b', 0.36], ['a', 0.3]]), s: pick([[1, 0.2], [2, 0.45], [3, 0.35]]) });
}
if (park) {
  const ok = (q, lng, lat) => !inLakePx(q) && shoreDist(q) > 7 && !inAny(lng, lat, woodFeats) && !inAny(lng, lat, hardFeats) && !nearPath(q, 7);
  for (const p of scatter(park, 26, 0.6, ok)) trees.push({ p, k: pick([['d', 0.09], ['c', 0.3], ['a', 0.34], ['b', 0.27]]), s: pick([[1, 0.4], [2, 0.45], [3, 0.15]]) });
}
for (const g of smallParks) {
  for (const p of scatter(g, 26, 0.5, (q, lng, lat) => !inAny(lng, lat, hardFeats) && !nearPath(q, 6))) trees.push({ p, k: pick([['a', 0.5], ['c', 0.35], ['d', 0.15]]), s: pick([[1, 0.5], [2, 0.5]]) });
}
trees.sort((a, b) => a.p[1] - b.p[1]);

// 잔디밭 꾸밈: 밝은 얼룩, 풀포기, 꽃무리(호수·숲·길은 피함)
const lawnOk = (q, lng, lat) => !inLakePx(q) && shoreDist(q) > 10 && !inAny(lng, lat, woodFeats) && !inAny(lng, lat, hardFeats);
const patches = park ? scatter(park, 64, 0.5, lawnOk).map((p) => ({ p, rx: 14 + rnd() * 18, ry: 8 + rnd() * 9, rot: Math.round(rnd() * 60 - 30) })) : [];
const tufts = park ? scatter(park, 40, 0.42, (q, lng, lat) => lawnOk(q, lng, lat) && !nearPath(q, 6)) : [];
const flowers = park ? scatter(park, 84, 0.4, (q, lng, lat) => lawnOk(q, lng, lat) && !nearPath(q, 7)).map((p) => ({ p, c: Math.floor(rnd() * 3), dots: Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => [rnd() * 9 - 4.5, rnd() * 7 - 3.5]) })) : [];

// 물가: 갈대(바깥쪽 3.5px), 수련 잎(안쪽), 오리, 물결
const reeds = [];
const pads = [];
for (const ring of lakeOuterPx) {
  let carry = 0;
  let idx = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    for (let t = 11 - carry; t <= len; t += 11) {
      idx++;
      const base = [a[0] + ux * t, a[1] + uy * t];
      // 바깥쪽 법선: 호수 안이 아닌 쪽
      const out = inLakePx([base[0] - uy * 4, base[1] + ux * 4]) ? [uy, -ux] : [-uy, ux];
      const clump = Math.sin(idx * 0.33) + Math.sin(idx * 0.097 + 2) > 0.25;
      if (clump) {
        const p = [base[0] + out[0] * 3.5 + rnd() * 2 - 1, base[1] + out[1] * 3.5 + rnd() * 2 - 1];
        if (!nearPath(p, 5) && !inLakePx(p)) reeds.push({ p, flip: rnd() < 0.5 });
      }
      if (Math.sin(idx * 0.21 + 4) + Math.sin(idx * 0.05) > 1.45 && rnd() < 0.55) {
        const inset = 7 + rnd() * 13;
        const p = [base[0] - out[0] * inset + rnd() * 6 - 3, base[1] - out[1] * inset + rnd() * 6 - 3];
        if (inLakePx(p) && shoreDist(p) > 4) pads.push({ p, r: 2.4 + rnd() * 1.6, rot: Math.round(rnd() * 360), bloom: rnd() < 0.22 });
      }
    }
    carry = (carry + len) % 11;
  }
}
const lakeBox = lakeRingsPx.flat().reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const lakeDots = (count, minShore, maxShore, gap, tries = 6000) => {
  const out = [];
  for (let i = 0; i < tries && out.length < count; i++) {
    const p = [lakeBox[0] + rnd() * (lakeBox[2] - lakeBox[0]), lakeBox[1] + rnd() * (lakeBox[3] - lakeBox[1])];
    if (!inLakePx(p)) continue;
    const d = shoreDist(p);
    if (d < minShore || d > maxShore) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < gap)) continue;
    out.push(p);
  }
  return out;
};
const ducks = lakeDots(8, 16, 60, 95).map((p) => ({ p, flip: rnd() < 0.5 }));
const waves = lakeDots(70, 24, 400, 30).map((p) => ({ p, s: rnd() < 0.4 ? 0.75 : 1 }));
const fountainEl = tagged.find((e) => e.type === 'node' && e.tags.amenity === 'fountain');
const fountain = fountainEl ? px(fountainEl.lon, fountainEl.lat) : null;

// 밤 테마: 산책로 가로등(약 46m마다), 불 켜진 창
const lamps = [];
for (const line of pathLinesPx) {
  let carry = rnd() * 46;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 46 - carry; t <= len; t += 46) lamps.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
    carry = (carry + len) % 46;
  }
}
const lampsKept = lamps.filter((p, i) => !lamps.slice(0, i).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 30));
const windows = buildings
  .filter(() => rnd() < 0.34)
  .map((g) => {
    const [lng, lat] = turf.centroid(turf.feature(g)).geometry.coordinates;
    const p = px(lng, lat);
    return Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [p[0] + rnd() * 14 - 7, p[1] + rnd() * 10 - 5]);
  })
  .flat()
  .filter((p) => p[0] > 0 && p[1] > 0 && p[0] < W && p[1] < H);

const MAP_THEMES = {
  // 밝고 포근한 낮 지도
  storybook: {
    file: 'public/map/park-map.svg',
    bg: '#f4eddc', block: '#eee5d1', building: '#e4d9c3', buildingStroke: null, road: '#fdf8ec', roadCase: null, sidewalk: '#f8f1e1',
    parkOut: '#cfe6a6', park: '#bfe18e', parkEdge: '#a5cf73', patch: '#cdeaa0', grass: '#d1eca2', wood: '#93cb6c', woodEdge: null,
    pitch: '#f3b78c', pitchLine: '#fff6e8', play: '#f8e0a4', stream: '#74cdd2', streamEdge: '#b9e9e6',
    sand: '#f7e7b6', lake: '#4fb7c4', bands: [[72, '#5cc1cb'], [44, '#6bcbd2'], [20, '#82d7da']], foam: '#eefbf6', contour: null, lakeInk: null,
    wave: '#ffffff', waveOp: 0.6, moon: null,
    pathCase: '#e0c686', path: '#fff2cb', pathDash: null, deck: ['#b17c4b', '#e4b77f'],
    tree: { a: ['#59aa4d', '#82cc68'], b: ['#479a52', '#6bbb64'], c: ['#8cc24f', '#b4db6d'], d: ['#e6b849', '#f4d77f'], e: ['#3b8a4c', '#59a965'] }, treeShadow: '#2c6a3a', treeShadowOp: 0.22, treeInk: null,
    tuft: '#8fc55f', flower: ['#ffffff', '#ffe27a', '#f9a9c9'], reed: ['#7ea550', '#ead8a0'], pad: '#5fb356', bloom: '#f8a9c6',
    duck: ['#8b6a4a', '#6a4e36', '#f4a53b', '#b08e66'], ink: null, lamp: null, window: null,
  },
};

function mapDefs(T) {
  const d = [];
  const sizes = { 1: 0.72, 2: 0.92, 3: 1.16 };
  for (const [k, [base, hi]] of Object.entries(T.tree)) {
    for (const [n, s] of Object.entries(sizes)) {
      const shadow = T.treeShadow ? `<ellipse cx="1.7" cy="3.3" rx="7.2" ry="5.2" fill="${T.treeShadow}" fill-opacity="${T.treeShadowOp}"/>` : '';
      const ink = T.treeInk ? ` stroke="${T.treeInk}" stroke-width=".9"` : '';
      let body;
      if (k === 'e') {
        // 침엽수: 위에서 본 뾰족한 별 모양
        body = `<path d="M0,-8.5L2.4,-3.2 7.6,-3.8 3.8,.6 6.4,6.6 0,3.8-6.4,6.6-3.8,.6-7.6,-3.8-2.4,-3.2Z" fill="${base}" stroke="${T.treeInk ?? base}" stroke-width="${T.treeInk ? 0.9 : 1.6}" stroke-linejoin="round"/>${hi ? `<circle cx="-.8" cy="-1" r="2.4" fill="${hi}"/>` : ''}`;
      } else {
        body = `<circle r="7" fill="${base}"${ink}/>${hi ? `<circle cx="-2.1" cy="-2.3" r="3.5" fill="${hi}"/>` : `<path d="M-3.6,-.4q1.5,-3.6 4.8,-2.9" fill="none" stroke="${T.treeInk}" stroke-width=".8" stroke-linecap="round"/>`}`;
      }
      d.push(`<g id="${k}${n}" transform="scale(${s})">${shadow}${body}</g>`);
    }
  }
  d.push(`<g id="gr" fill="none" stroke="${T.tuft}" stroke-width="1.1" stroke-linecap="round"><path d="M-2.2,0l.9,-3M0,0v-3.8M2.2,0l-.9,-3"/></g>`);
  d.push(`<g id="rd"><path d="M0,0L-2.2,-6M0,0L.3,-7.6M0,0L2.5,-5.6" fill="none" stroke="${T.reed[0]}" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="-2.4" cy="-6.6" rx=".9" ry="1.7" fill="${T.reed[1]}" transform="rotate(-18 -2.4 -6.6)"/><ellipse cx=".3" cy="-8.3" rx=".9" ry="1.8" fill="${T.reed[1]}"/><ellipse cx="2.8" cy="-6.2" rx=".9" ry="1.6" fill="${T.reed[1]}" transform="rotate(22 2.8 -6.2)"/></g>`);
  const [body, head, beak, wing] = T.duck;
  d.push(`<g id="dk"><path d="M-10,4.2q5,2.6 10,0t10,0" fill="none" stroke="${T.wave}" stroke-opacity="${T.waveOp}" stroke-width="1.2" stroke-linecap="round"/><ellipse rx="5.6" ry="3.5" fill="${body}"/><path d="M-5.4,-.6q2.6,-3.2 6,-1.2q-3,2.4-6,1.2Z" fill="${wing}"/><circle cx="5" cy="-2.9" r="2.5" fill="${head}"/><path d="M7.1,-3.3l3.3,.7-3.3,1Z" fill="${beak}"/></g>`);
  d.push(`<path id="wv" d="M-7,0q3.5,-3 7,0t7,0" fill="none" stroke="${T.wave}" stroke-opacity="${T.waveOp}" stroke-width="1.3" stroke-linecap="round"/>`);
  if (T.lamp) d.push(`<g id="lm"><circle r="7" fill="${T.lamp}" fill-opacity=".14"/><circle r="3.4" fill="${T.lamp}" fill-opacity=".3"/><circle r="1.5" fill="${T.lamp}"/></g>`);
  return d.join('');
}

function renderMap(T) {
  const S = [];
  const lakeD = geomD(lake, true);
  const parkD = park ? geomD(park, true) : '';
  const g = (attrs, items) => (items.length ? S.push(`<g ${attrs}>${items.join('')}</g>`) : 0);
  const paths1 = (list, attr = '') => list.map((d) => `<path d="${d}"${attr}/>`);

  S.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  S.push(`<defs><clipPath id="lake"><path d="${lakeD}" clip-rule="evenodd"/></clipPath>${parkD ? `<clipPath id="park"><path d="${parkD}" clip-rule="evenodd"/></clipPath>` : ''}${mapDefs(T)}</defs>`);
  S.push(`<rect width="${W}" height="${H}" fill="${T.bg}"/>`);

  // 도시: 한 톤으로 조용하게
  g(`fill="${T.block}" stroke="${T.block}" stroke-width="3" stroke-linejoin="round"`, paths1(urban.map((x) => geomD(x))));
  S.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  if (T.roadCase) g(`stroke="${T.roadCase}"`, roads.map((e) => `<path d="${lineD(e)}" stroke-width="${f1(roadW(e) * 0.72 + 2.2)}"/>`));
  g(`stroke="${T.road}"`, roads.map((e) => `<path d="${lineD(e)}" stroke-width="${f1(roadW(e) * 0.72)}"/>`));
  g(`stroke="${T.sidewalk}" stroke-width="2"`, paths1(pathsOut.map((e) => lineD(e))));
  S.push('</g>');
  g(`fill="${T.building}"${T.buildingStroke ? ` stroke="${T.buildingStroke}" stroke-width=".9"` : ` stroke="${T.building}" stroke-width="1.6"`} stroke-linejoin="round"`, paths1(buildings.map((x) => geomD(x))));
  if (T.window) g(`fill="${T.window}" fill-opacity=".85"`, windows.map((p) => `<rect x="${f1(p[0])}" y="${f1(p[1])}" width="1.8" height="2.4"/>`));

  // 공원 바탕
  g(`fill="${T.parkOut}"`, paths1(smallParks.map((x) => geomD(x, true))));
  if (parkD) S.push(`<path d="${parkD}" fill="${T.park}" fill-rule="evenodd"${T.parkEdge ? ` stroke="${T.parkEdge}" stroke-width="3" stroke-linejoin="round"` : ''}/>`);
  if (T.patch && parkD) g(`clip-path="url(#park)" fill="${T.patch}" fill-opacity=".7"`, patches.map((q) => `<ellipse cx="${f1(q.p[0])}" cy="${f1(q.p[1])}" rx="${f1(q.rx)}" ry="${f1(q.ry)}" transform="rotate(${q.rot} ${f1(q.p[0])} ${f1(q.p[1])})"/>`));
  g(`fill="${T.grass}"`, paths1(grass.map((x) => geomD(x, true))));
  g(`fill="${T.wood}" fill-rule="evenodd"${T.woodEdge ? ` stroke="${T.woodEdge}" stroke-width="1.2" stroke-linejoin="round"` : ''}`, paths1(woods.map((x) => geomD(x, true))));
  g(`fill="${T.pitch}" stroke="${T.pitchLine}" stroke-width="1.4" stroke-linejoin="round"`, paths1(pitches.map((x) => geomD(x))));
  g(`fill="${T.play}"`, paths1(playgrounds.map((x) => geomD(x))));
  for (const x of playgrounds) {
    const [lng, lat] = turf.centroid(turf.feature(x)).geometry.coordinates;
    const c = px(lng, lat);
    S.push(`<g><circle cx="${f1(c[0] - 4)}" cy="${f1(c[1] + 1)}" r="2.2" fill="#ef7f6b"/><circle cx="${f1(c[0] + 1)}" cy="${f1(c[1] - 3)}" r="2.2" fill="#5fa8e6"/><circle cx="${f1(c[0] + 5)}" cy="${f1(c[1] + 2)}" r="2.2" fill="#f4c64f"/></g>`);
  }
  if (T.ink && parkD) S.push(`<path d="${parkD}" fill="none" stroke="${T.ink}" stroke-width="1.4" stroke-linejoin="round"/><path d="${parkD}" fill="none" stroke="${T.ink}" stroke-opacity=".3" stroke-width="1" transform="translate(1.2 .9)"/>`);

  // 물
  S.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  g(`stroke="${T.streamEdge}"`, streams.map((e) => `<path d="${lineD(e)}" stroke-width="${T.ink ? 10.6 : 12}"/>`));
  g(`stroke="${T.stream}"`, streams.map((e) => `<path d="${lineD(e)}" stroke-width="8.5"/>`));
  S.push('</g>');
  if (T.sand) S.push(`<path d="${lakeD}" fill="none" stroke="${T.sand}" stroke-width="10" stroke-linejoin="round"/>`);
  S.push(`<path d="${lakeD}" fill="${T.lake}" fill-rule="evenodd"/>`);
  S.push('<g clip-path="url(#lake)" fill="none" stroke-linejoin="round">');
  // 물가로 갈수록 옅어지는 띠(선은 물가 중심, 안쪽 절반만 보임)
  if (T.contour) for (const d of [50, 30, 14]) S.push(`<path d="${lakeD}" stroke="${T.contour}" stroke-width="${2 * d + 0.9}" stroke-dasharray="5 4"/><path d="${lakeD}" stroke="${T.lake}" stroke-width="${2 * d - 0.9}"/>`);
  for (const [d, color] of T.bands) S.push(`<path d="${lakeD}" stroke="${color}" stroke-width="${2 * d}"/>`);
  if (T.foam) S.push(`<path d="${lakeD}" stroke="${T.foam}" stroke-opacity="${T.lamp ? 0.5 : 0.95}" stroke-width="${T.lamp ? 3 : 5}"/>`);
  if (T.moon) {
    const cx = (lakeBox[0] + lakeBox[2]) / 2 + 60;
    const cy = (lakeBox[1] + lakeBox[3]) / 2 + 10;
    for (const [dy, w, o] of [[-22, 46, 0.1], [-11, 78, 0.13], [0, 104, 0.16], [11, 84, 0.13], [22, 58, 0.1], [33, 30, 0.08]]) S.push(`<path d="M${f1(cx - w / 2)},${f1(cy + dy)}h${w}" stroke="${T.moon}" stroke-opacity="${o}" stroke-width="3.2" stroke-linecap="round"/>`);
  }
  S.push('</g>');
  if (T.lakeInk) S.push(`<path d="${lakeD}" fill="none" stroke="${T.lakeInk}" stroke-width="1.5" stroke-linejoin="round"/><path d="${lakeD}" fill="none" stroke="${T.lakeInk}" stroke-opacity=".3" stroke-width="1" transform="translate(1.1 .9)"/>`);
  g('', waves.map((q) => `<use href="#wv" x="${f1(q.p[0])}" y="${f1(q.p[1])}"${q.s < 1 ? ` transform="translate(${f1(q.p[0] * (1 - q.s))} ${f1(q.p[1] * (1 - q.s))}) scale(${q.s})"` : ''}/>`));
  g('', pads.map((q) => `<g transform="translate(${f1(q.p[0])} ${f1(q.p[1])}) rotate(${q.rot})"><path d="M0,0L${f1(q.r)},-${f1(q.r * 0.34)}A${f1(q.r)},${f1(q.r)} 0 1 0 ${f1(q.r)},${f1(q.r * 0.34)}Z" fill="${T.pad}"${T.ink ? ` stroke="${T.ink}" stroke-width=".6"` : ''}/>${q.bloom ? `<circle cx="-${f1(q.r * 0.3)}" r="1.1" fill="${T.bloom}"/>` : ''}</g>`));
  if (fountain) {
    const [x, y] = fountain;
    S.push(`<g transform="translate(${f1(x)} ${f1(y)})"><circle r="9" fill="${T.wave}" fill-opacity=".18"/><circle r="5.5" fill="none" stroke="${T.wave}" stroke-opacity=".7" stroke-width="1.2"/><path d="M0,1V-9M-3,1q-1,-6-5,-6.5M3,1q1,-6 5,-6.5" fill="none" stroke="${T.ink ?? '#ffffff'}" stroke-width="1.4" stroke-linecap="round"/><circle cy="-9.6" r="1.2" fill="${T.ink ?? '#ffffff'}"/></g>`);
  }
  g('', ducks.map((q) => `<use href="#dk" transform="translate(${f1(q.p[0])} ${f1(q.p[1])}) scale(${q.flip ? -1.25 : 1.25} 1.25)"/>`));

  // 다리·산책로
  g(`fill="${T.road}" stroke="${T.roadCase ?? T.block}" stroke-width="1.5" stroke-linejoin="round"`, paths1(bridges.map((x) => geomD(x))));
  // 정자·쉼터: 작은 지붕
  g(`fill="${T.deck[1]}" stroke="${T.deck[0]}" stroke-width="1.2" stroke-linejoin="round"`, paths1(shelters.map((x) => geomD(x))));
  const stepDash = (e) => (e.tags.highway === 'steps' ? ' stroke-dasharray="2.2 2"' : '');
  const land = pathsIn.filter((e) => !e.tags.bridge || e.tags.bridge === 'no');
  const decks = pathsIn.filter((e) => e.tags.bridge && e.tags.bridge !== 'no');
  S.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  if (T.lamp) g(`stroke="${T.pathCase}" stroke-opacity=".16" stroke-width="10"`, paths1(land.map((e) => lineD(e))));
  else g(`stroke="${T.pathCase}" stroke-width="${T.pathDash ? 5.2 : 6.6}"`, paths1(land.map((e) => lineD(e))));
  g(`stroke="${T.path}" stroke-width="${T.lamp ? 2.6 : T.pathDash ? 1.5 : 4.5}"${T.pathDash ? ` stroke-dasharray="${T.pathDash}"` : ''}`, land.map((e) => `<path d="${lineD(e)}"${T.pathDash ? '' : stepDash(e)}/>`));
  // 물 위·길 위 다리: 나무 널 느낌(가는 가로줄)
  g(`stroke="${T.deck[0]}" stroke-width="8.4" stroke-linecap="butt"`, paths1(decks.map((e) => lineD(e))));
  g(`stroke="${T.deck[1]}" stroke-width="6" stroke-linecap="butt"`, paths1(decks.map((e) => lineD(e))));
  g(`stroke="${T.deck[0]}" stroke-opacity=".55" stroke-width="6" stroke-linecap="butt" stroke-dasharray=".7 2.6"`, paths1(decks.map((e) => lineD(e))));
  S.push('</g>');

  // 풀·꽃·갈대·나무
  g('', tufts.map((p) => `<use href="#gr" x="${f1(p[0])}" y="${f1(p[1])}"/>`));
  g('', flowers.map((q) => q.dots.map(([dx, dy]) => `<circle cx="${f1(q.p[0] + dx)}" cy="${f1(q.p[1] + dy)}" r="1.15" fill="${T.flower[q.c]}"/>`).join('')));
  g('', reeds.map((q) => `<use href="#rd" ${q.flip ? `transform="translate(${f1(q.p[0])} ${f1(q.p[1])}) scale(-1 1)"` : `x="${f1(q.p[0])}" y="${f1(q.p[1])}"`}/>`));
  g('', trees.map((t) => `<use href="#${t.k}${t.s}" x="${f1(t.p[0])}" y="${f1(t.p[1])}"/>`));
  if (T.lamp) g('', lampsKept.map((p) => `<use href="#lm" x="${f1(p[0])}" y="${f1(p[1])}"/>`));
  if (T.ink) {
    // 수첩 지도의 방위표(왼쪽 아래 빈 곳)
    S.push(`<g transform="translate(74 1236)" fill="none" stroke="${T.ink}" stroke-linecap="round" stroke-linejoin="round"><circle r="19" stroke-width="1.1"/><circle r="15.5" stroke-width=".6" stroke-dasharray="1.5 3"/><path d="M0,-13L4,2H-4Z" fill="#b4432b" stroke="none"/><path d="M0,13L4,2H-4Z" fill="${T.ink}" fill-opacity=".35" stroke="none"/><path d="M-3,-22v-7l6,7v-7" stroke-width="1.3"/></g>`);
  }
  S.push('</svg>');
  return S.join('\n') + '\n';
}

for (const [name, T] of Object.entries(MAP_THEMES)) {
  const svg = renderMap(T);
  writeFileSync(new URL(T.file, root), svg);
  console.log(`${name}: ${T.file} ${(svg.length / 1024).toFixed(0)}KB`);
}
console.log(`건물 ${buildings.length} · 도로 ${roads.length} · 산책로 ${pathsIn.length}(+밖 ${pathsOut.length}) · 숲 ${woods.length} · 나무 ${trees.length} · 갈대 ${reeds.length} · 수련 ${pads.length} · 오리 ${ducks.length} · 가로등 ${lampsKept.length}`);

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
// 지도에 쓰는 쉬운 이름(조사구역 이름은 기록·검토에서 그대로 씁니다)
const MAP_LABEL = { Z1: '물 위', Z2: '물가 풀숲', Z3: '숲 언덕', Z4: '나무 정원', Z5: '잔디 마당', Z6: '공원 가는 길' };
content.zones = order
  .map((id) => {
    const old = content.zones.find((z) => z.id === id);
    const f = zoneGeo[id];
    if (!f) throw new Error(`${id} 도형을 만들지 못했어요`);
    return { ...old, mapLabel: MAP_LABEL[id], center: labelPoint(id), geometry: roundGeom(f.geometry), placeholder: derived[id], boundary: derived[id] ? '임시(남북 분할)' : 'OSM 지형' };
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
  // 호수를 지나는 구간은 빼고(이름표가 호수 한가운데 놓이지 않게) 물길이 보이는 곳에 둡니다.
  const lakeZone = turf.buffer(lakeOuterOnly, 30, { units: 'meters' });
  const visible = inside.filter((p) => !turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), lakeZone));
  const mid = (visible.length ? visible : inside)[Math.floor((visible.length || inside.length) * 0.25)];
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
  // 지도 그림이 바뀌면 값이 바뀝니다(기기에 둔 지도 사본을 새로 받게 함).
  rev: createHash('sha1').update(readFileSync(new URL(MAP_THEMES.storybook.file, root))).digest('hex').slice(0, 8),
  attribution: '지도 데이터 © OpenStreetMap 기여자',
  osmFetchedAt: fetchedAt.slice(0, 10),
  focus: [r6(lakeLabel[1]), r6(lakeLabel[0])],
  // 지도 홈의 쿼터뷰 블록 지도 값은 build-iso.mjs가 적습니다(여기서는 그대로 둠).
  ...(content.map?.iso ? { iso: content.map.iso } : {}),
};
content.placeholders = [
  ...content.placeholders.filter((p) => !/^map\.image|^zones|^facilities|^biotopes/.test(p)),
  'zones: Z1(호수)·Z2(호숫가 35m)·Z3(숲)·Z6(공원 밖)은 OSM 지형에서 계산, Z4·Z5는 공원 안내도 전 임시 남북 분할',
  'facilities: OSM에 있는 이름만(동탄호수·루나분수·태봉산·송방천·섬). 현자의 정원 등 PRD 시설은 위치 확인 후 추가',
  'biotopes: 호수 1개만 임시. biotope_samples_4326.geojson(97개)으로 교체',
];
// 관찰 지점 배열([lat, lng, n])은 한 줄로(build-sightings.mjs와 같게)
writeFileSync(contentUrl, JSON.stringify(content, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(\d+)\s+\]/g, '[$1, $2, $3]') + '\n');
console.log('구역 중심', content.zones.map((z) => `${z.id}@${z.center.join(',')}`).join(' '));
console.log('지도 이름', facilities.map((f) => f.name).join(', '));
