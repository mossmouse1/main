// 지도 홈의 쿼터뷰 블록 지도(public/map/park-iso.svg)를 만들고, 좌표 변환 값을 v1.json(map.iso)에 적습니다.
//
// 그리는 법
// - 땅을 10m 칸으로 나눠 칸마다 종류(잔디·물·산책로·찻길·숲…)를 OSM 도형으로 정합니다. 호수·길·숲·건물 자리는 실제와 같습니다.
// - 남동쪽 하늘에서 내려다본 2:1 쿼터뷰입니다: 화면 x = 동 − 남, 화면 y = (동 + 남) / 2 − 높이.
//   (북쪽이 화면 오른쪽 위, 동쪽이 오른쪽 아래)
// - 호수는 한 단 낮고(물가에 흙 벽이 보임), 숲 언덕은 안쪽으로 갈수록 한 단씩 높아집니다.
// - 받아 둔 OSM 자료 범위(공원 + 둘레 약 150m) 바깥은 화면이 비지 않게 블록 마을·숲으로 채웁니다(꾸밈, 실제와 다름).
// 지도 데이터 © OpenStreetMap 기여자 (ODbL)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import sharp from 'sharp';
import { loadPark } from './lib/osm.mjs';

const root = new URL('..', import.meta.url);
const contentUrl = new URL('public/content/v1.json', root);
const content = JSON.parse(readFileSync(contentUrl, 'utf8'));
const osm = loadPark(root, content.park.bounds);

// ---------- 투영 ----------
const [lat0, lng0] = content.map.focus; // 호수 가운데가 원점
const M_LAT = 111320;
const M_LNG = Math.round(111320 * Math.cos((lat0 * Math.PI) / 180));
/** 그림 범위(화면 단위 = 대략 m). 공원 전체가 들어가고, 세로로 긴 휴대폰에서 호수 전체가 보일 만큼 위아래를 넉넉히 둡니다. */
const X0 = -908;
const Y0 = -1070;
const W = 1600;
const H = 2500;
const C = 10; // 한 칸(m)
const ZS = 5; // 한 단 높이
const WATER_Z = -4;

const ground = (lng, lat) => [(lng - lng0) * M_LNG, (lat0 - lat) * M_LAT];
const lnglat = (gx, gy) => [lng0 + gx / M_LNG, lat0 - gy / M_LAT];
const iso = (gx, gy, z = 0) => [gx - gy - X0, (gx + gy) / 2 - z - Y0];
const n1 = (n) => String(Math.round(n * 10) / 10);
const pt = ([x, y]) => `${n1(x)},${n1(y)}`;
/** 격자 꼭짓점(vi, vj)의 화면 좌표 */
const V = (vi, vj, z = 0) => iso(vi * C, vj * C, z);

// ---------- 격자 ----------
const I0 = -160;
const J0 = -150;
const NI = 360;
const NJ = 360;
const idx = (i, j) => i - I0 + (j - J0) * NI;
const inGrid = (i, j) => i >= I0 && i < I0 + NI && j >= J0 && j < J0 + NJ;
const NONE = 0, TOWN = 1, GRASS = 2, WATER = 3, PATH = 4, ROAD = 5, WOOD = 6, PITCH = 7, PLAY = 8, DECK = 9, WOODF = 10;
const type = new Uint8Array(NI * NJ);
const level = new Int8Array(NI * NJ);
const real = new Uint8Array(NI * NJ);
const occ = new Uint8Array(NI * NJ); // 건물·시설이 차지한 칸(나무를 심지 않음)
const T = (i, j) => (inGrid(i, j) ? type[idx(i, j)] : NONE);
/** 그림에 걸치는 칸만 씁니다(아래쪽은 키 큰 건물이 올라와 보이므로 조금 더). */
const inView = (i, j) => {
  const [x, y] = V(i, j);
  return x > -C - 30 && x < W + C + 30 && y > -C - 50 && y < H + 130;
};

const hash = (a, b, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** 부드러운 값 잡음(0~1). scale: 덩어리 크기(m) */
const noise = (x, y, scale, s) => {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sm = (t) => t * t * (3 - 2 * t);
  const tx = sm(fx - ix);
  const ty = sm(fy - iy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};
const mod = (n, m) => ((n % m) + m) % m;

// 1) 바탕: 자료 범위 안은 마을 바닥, 밖은 꾸밈(마을 + 숲 덩어리 + 바둑판 길)
const D = osm.dataBounds;
for (let j = J0; j < J0 + NJ; j++) {
  for (let i = I0; i < I0 + NI; i++) {
    if (!inView(i, j)) continue;
    const gx = (i + 0.5) * C;
    const gy = (j + 0.5) * C;
    const [lng, lat] = lnglat(gx, gy);
    const k = idx(i, j);
    real[k] = lat > D.south && lat < D.north && lng > D.west && lng < D.east ? 1 : 0;
    if (real[k]) type[k] = TOWN;
    else {
      const far = Math.min(1, Math.max(0, (Math.hypot(gx, gy * 0.8) - 700) / 700));
      const n = noise(gx, gy, 300, 1) - (1 - far) * 0.3;
      type[k] = n > 0.64 ? WOODF : n > 0.58 ? GRASS : mod(i, 15) === 7 || mod(j, 15) === 4 ? ROAD : TOWN;
    }
  }
}

// 2) OSM 도형을 칸에 옮깁니다(뒤에 오는 것이 덮어씀).
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function fillGeom(geom, fn) {
  for (const rings of polysOf(geom)) {
    const f = turf.polygon(rings);
    const [w, s, e, n] = turf.bbox(f);
    const [gx0, gy1] = ground(w, s);
    const [gx1, gy0] = ground(e, n);
    for (let j = Math.floor(gy0 / C); j <= Math.floor(gy1 / C); j++) {
      for (let i = Math.floor(gx0 / C); i <= Math.floor(gx1 / C); i++) {
        if (!T(i, j)) continue;
        if (turf.booleanPointInPolygon(lnglat((i + 0.5) * C, (j + 0.5) * C), f)) fn(i, j);
      }
    }
  }
}
/** 선을 따라 반경 r(m) 안의 칸. r = 0이면 지나는 칸만(모서리로만 닿지 않게 이어 줌). */
function strokeLine(el, r, fn) {
  const pts = el.geometry.map((p) => ground(p.lon, p.lat));
  let prev = null;
  for (let s = 1; s < pts.length; s++) {
    const [ax, ay] = pts[s - 1];
    const [bx, by] = pts[s];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2.5));
    for (let t = 0; t <= steps; t++) {
      const x = ax + ((bx - ax) * t) / steps;
      const y = ay + ((by - ay) * t) / steps;
      const ci = Math.floor(x / C);
      const cj = Math.floor(y / C);
      if (r <= 0) {
        if (prev && prev[0] !== ci && prev[1] !== cj && T(prev[0], cj)) fn(prev[0], cj);
        if (T(ci, cj)) fn(ci, cj);
        prev = [ci, cj];
        continue;
      }
      for (let j = Math.floor((y - r) / C); j <= Math.floor((y + r) / C); j++) {
        for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
          if (T(i, j) && Math.hypot((i + 0.5) * C - x, (j + 0.5) * C - y) <= r) fn(i, j);
        }
      }
    }
  }
}
const set = (t) => (i, j) => {
  type[idx(i, j)] = t;
};
const parkGeoms = [osm.park, ...osm.smallParks].filter(Boolean);
const inPark = new Uint8Array(NI * NJ);
for (const g of parkGeoms) fillGeom(g, (i, j) => ((type[idx(i, j)] = GRASS), (inPark[idx(i, j)] = 1)));
for (const g of osm.grass) fillGeom(g, set(GRASS));
for (const g of osm.woods) fillGeom(g, set(WOOD));
for (const g of osm.pitches) fillGeom(g, set(PITCH));
for (const g of osm.playgrounds) fillGeom(g, set(PLAY));
const ROAD_R = { motorway: 11, motorway_link: 6, trunk: 10, primary: 10, secondary: 9, secondary_link: 5, tertiary: 6.5, tertiary_link: 5, residential: 5.5, unclassified: 5.5, living_street: 5 };
const ribbons = [];
const midInPark = (e) => {
  const m = e.geometry[Math.floor(e.geometry.length / 2)];
  const [gx, gy] = ground(m.lon, m.lat);
  const i = Math.floor(gx / C);
  const j = Math.floor(gy / C);
  return inGrid(i, j) && !!inPark[idx(i, j)];
};
const parkLines = [];
for (const e of osm.roads) {
  const r = ROAD_R[e.tags.highway];
  if (r) strokeLine(e, r, set(ROAD));
  else if (midInPark(e)) parkLines.push(e); // 공원 안 관리용 길은 산책로처럼
  else strokeLine(e, 0, set(ROAD));
}
fillGeom(osm.lake, set(WATER));
for (const e of osm.streams) strokeLine(e, 5.5, (i, j) => (type[idx(i, j)] === ROAD ? 0 : (type[idx(i, j)] = WATER)));
// 산책로: 공원 안의 길만. 물 위를 지나면 나무다리(DECK), 숲 언덕을 지나면 길 자리를 팝니다(PATH).
for (const e of [...parkLines, ...osm.paths.filter(midInPark)]) {
  ribbons.push(e.geometry.map((p) => ground(p.lon, p.lat)));
  strokeLine(e, 0, (i, j) => {
    const k = idx(i, j);
    if (type[k] === WATER) type[k] = DECK;
    else if (type[k] === WOOD) type[k] = PATH;
  });
}

// 3) 높이: 숲 언덕은 가장자리에서 두 칸 들어갈 때마다 한 단(최대 3단)
{
  const dist = new Int16Array(NI * NJ).fill(-1);
  let frontier = [];
  for (let j = J0; j < J0 + NJ; j++) {
    for (let i = I0; i < I0 + NI; i++) {
      if (T(i, j) !== WOOD) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const t = T(i + di, j + dj);
        return t !== WOOD && t !== NONE;
      });
      if (edge) {
        dist[idx(i, j)] = 1;
        frontier.push([i, j]);
      }
    }
  }
  while (frontier.length) {
    const next = [];
    for (const [i, j] of frontier) {
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (T(a, b) !== WOOD || dist[idx(a, b)] !== -1) continue;
        dist[idx(a, b)] = dist[idx(i, j)] + 1;
        next.push([a, b]);
      }
    }
    frontier = next;
  }
  for (let k = 0; k < type.length; k++) if (type[k] === WOOD) level[k] = dist[k] < 0 ? 3 : Math.min(3, Math.ceil(dist[k] / 2));
}
/** 칸 윗면의 높이(화면 단위) */
const zOf = (i, j) => {
  const t = T(i, j);
  return t === WATER ? WATER_Z : t === WOOD ? level[idx(i, j)] * ZS : 0;
};

// ---------- 색 ----------
const COL = {
  base: '#5b4a35',
  [TOWN]: ['#ebe6d8', '#f3efe3', '#e1dbca'],
  [GRASS]: ['#8fc843', '#a2d556', '#80ba37'],
  [WOODF]: ['#77b53c', '#86c048', '#6aa733'],
  [WOOD]: ['#74b23b', '#83be47', '#67a332'],
  [WATER]: ['#8fd4ec', '#a8e0f2', '#7cc8e4'],
  [PATH]: ['#e9d5a2'],
  [ROAD]: ['#cdc7ba'],
  [PITCH]: ['#eaa878'],
  [PLAY]: ['#f4d98e'],
  [DECK]: ['#dcae6c'],
  soil: ['#7a5130', '#946540'], // [왼쪽(남쪽) 면, 오른쪽(동쪽) 면]
  stone: ['#b8b2a2', '#cdc8b9'],
  wood: ['#8f6638', '#a97d48'],
};
const wallKind = (t) => (t === TOWN || t === ROAD ? 'stone' : t === DECK ? 'wood' : 'soil');

// ---------- 바닥: 종류별 테두리를 따서 한 덩어리로 ----------
/** 칸 묶음의 테두리 고리들(격자 꼭짓점). 바깥은 시계 방향, 구멍은 반대 방향. */
function trace(has) {
  const out = new Map();
  const enc = (a, b) => (a - I0 + 1) * 4096 + (b - J0 + 1);
  const dec = (k) => [Math.floor(k / 4096) + I0 - 1, (k % 4096) + J0 - 1];
  const add = (a, b, c, d) => {
    const k = enc(a, b);
    const list = out.get(k);
    if (list) list.push([c, d]);
    else out.set(k, [[c, d]]);
  };
  for (let j = J0; j < J0 + NJ; j++) {
    for (let i = I0; i < I0 + NI; i++) {
      if (!has(i, j)) continue;
      if (!has(i, j - 1)) add(i, j, i + 1, j);
      if (!has(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!has(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!has(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  const loops = [];
  for (const [k0, list0] of out) {
    while (list0.length) {
      const start = dec(k0);
      const loop = [start];
      let cur = start;
      for (;;) {
        const list = out.get(enc(cur[0], cur[1]));
        const nxt = list.pop();
        if (nxt[0] === start[0] && nxt[1] === start[1]) break;
        loop.push(nxt);
        cur = nxt;
      }
      // 한 줄 위의 점은 뺍니다.
      const slim = loop.filter((p, n) => {
        const a = loop[(n - 1 + loop.length) % loop.length];
        const b = loop[(n + 1) % loop.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      loops.push(slim);
    }
  }
  return loops;
}
const regionD = (has, z = 0) => trace(has).map((loop) => 'M' + loop.map(([a, b]) => pt(V(a, b, z))).join('L') + 'Z').join('');
/** 2×2칸(20m) 타일에 밝고 어두운 얼룩을 넣어 블록 느낌을 냅니다. */
function shadeTiles(t, z = 0) {
  const tiles = [[], []];
  for (let j = J0; j < J0 + NJ; j += 2) {
    for (let i = I0; i < I0 + NI; i += 2) {
      if (T(i, j) !== t || T(i + 1, j) !== t || T(i, j + 1) !== t || T(i + 1, j + 1) !== t) continue;
      const r = hash(i, j, 21);
      if (r > 0.44) continue;
      const [x, y] = V(i, j, z);
      tiles[r < 0.24 ? 0 : 1].push(`M${n1(x)},${n1(y)}l${2 * C},${C}-${2 * C},${C}-${2 * C}-${C}z`);
    }
  }
  return tiles;
}

const S = [];
S.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);

// ---------- 꾸밈 조각(defs) ----------
const defs = [];
{
  const sizes = { 1: 0.8, 2: 1, 3: 1.25 };
  // 뾰족한 나무(침엽수)와 네모 나무(활엽수): 왼쪽 면은 어둡게, 오른쪽 면은 밝게
  const cones = { c: ['#3f8a35', '#55a444', '#2f7029'], k: ['#4c9440', '#66b352', '#3b7b33'] };
  const cubes = { r: ['#5aa63c', '#79c153', '#96d46b'], s: ['#6db344', '#8bcb5b', '#a8dc75'], y: ['#d9a43a', '#efc257', '#f8da7d'], o: ['#d9793a', '#ee9a55', '#f7b97b'] };
  const trunk = '<path d="M-1.4,0.6L0,1.3 1.4,0.6V-5H-1.4Z" fill="#7a5230"/>';
  const shadow = '<ellipse cx="2" cy="1" rx="7.5" ry="3.4" fill="#1f3d12" fill-opacity=".2"/>';
  for (const [n, s] of Object.entries(sizes)) {
    for (const [k, [dark, light]] of Object.entries(cones)) {
      defs.push(
        `<g id="t${k}${n}" transform="scale(${s})">${shadow}${trunk}` +
          `<path d="M0,-17L-8,-4.5 0,-1.5Z" fill="${dark}"/><path d="M0,-17L8,-4.5 0,-1.5Z" fill="${light}"/>` +
          `<path d="M0,-25L-6,-12 0,-9.5Z" fill="${dark}"/><path d="M0,-25L6,-12 0,-9.5Z" fill="${light}"/></g>`,
      );
    }
    for (const [k, [dark, light, top]] of Object.entries(cubes)) {
      defs.push(
        `<g id="t${k}${n}" transform="scale(${s})">${shadow}${trunk}` +
          `<path d="M-7,-16.5V-8L0,-4.5V-13Z" fill="${dark}"/><path d="M7,-16.5V-8L0,-4.5V-13Z" fill="${light}"/><path d="M0,-20L7,-16.5 0,-13-7,-16.5Z" fill="${top}"/></g>`,
      );
    }
  }
  // 갈대, 오리, 수련 잎, 물 반짝임
  defs.push('<g id="rd"><path d="M0,0L-2.2,-6.5M0,0L.3,-8M0,0L2.6,-6" fill="none" stroke="#6e9a3c" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="-2.4" cy="-7.2" rx=".9" ry="1.8" fill="#e9d79a"/><ellipse cx=".3" cy="-8.8" rx=".9" ry="1.9" fill="#f1e2ad"/><ellipse cx="2.9" cy="-6.7" rx=".9" ry="1.7" fill="#e9d79a"/></g>');
  defs.push(
    '<g id="dk"><ellipse cx="0" cy="2.2" rx="9" ry="3.6" fill="#ffffff" fill-opacity=".5"/>' +
      '<path d="M-5.5,-1L0,-3.8 5.5,-1 0,1.8Z" fill="#b08a5f"/><path d="M-5.5,-1L0,1.8V4.4L-5.5,1.6Z" fill="#7e5e3d"/><path d="M5.5,-1L0,1.8V4.4L5.5,1.6Z" fill="#98744d"/>' +
      '<path d="M1.6,-6.6L4.4,-8 7.2,-6.6 4.4,-5.2Z" fill="#8c6c49"/><path d="M1.6,-6.6L4.4,-5.2V-2L1.6,-3.4Z" fill="#5f4630"/><path d="M7.2,-6.6L4.4,-5.2V-2L7.2,-3.4Z" fill="#765a3d"/>' +
      '<path d="M7.2,-5.6l3,.5-3,1.3Z" fill="#f5a63a"/><circle cx="5.6" cy="-5.6" r=".55" fill="#1d1a16"/></g>',
  );
  defs.push('<g id="lp"><path d="M0,0L4,-.9A4.2,2.1 0 1 0 4,.9Z" fill="#5fb04a"/></g>');
  defs.push('<path id="sp" d="M-4,0h5M3,0h2" fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.1" stroke-linecap="round"/>');
  // 놀이터(작은 블록들), 분수
  defs.push(
    '<g id="pg"><path d="M-8,-4L-3,-6.5 2,-4-3,-1.5Z" fill="#f08c6c"/><path d="M-8,-4L-3,-1.5V3.5L-8,1Z" fill="#c9634a"/><path d="M2,-4L-3,-1.5V3.5L2,1Z" fill="#de7558"/>' +
      '<path d="M3,-9L7,-11 11,-9 7,-7Z" fill="#6fb5ee"/><path d="M3,-9L7,-7V3L3,1Z" fill="#3f86c4"/><path d="M11,-9L7,-7V3L11,1Z" fill="#559fda"/>' +
      '<path d="M-2,3L2,1 6,3 2,5Z" fill="#f8d560"/><path d="M-2,3L2,5V8L-2,6Z" fill="#d3a93a"/><path d="M6,3L2,5V8L6,6Z" fill="#e6bf4b"/></g>',
  );
  defs.push(
    '<g id="ft"><ellipse rx="11" ry="5.5" fill="#ffffff" fill-opacity=".35"/><ellipse rx="6.5" ry="3.2" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="1.3"/>' +
      '<path d="M0,0V-15M-2,0q-1.5,-9-7,-9.5M2,0q1.5,-9 7,-9.5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/><circle cy="-16" r="1.5" fill="#ffffff"/></g>',
  );
}

// ---------- 건물(실제 발자국을 위로 올림) ----------
const PALETTES = [
  { wall: ['#d9cdb2', '#f4ebd7'], line: '#c4b697', roof: '#dfe5e8', roofLine: '#c3cdd3' }, // 크림 + 회색 지붕
  { wall: ['#cfd3d6', '#eef0f1'], line: '#b7bdc2', roof: '#9fc2d4', roofLine: '#86aabd' }, // 흰 벽 + 하늘색 지붕
  { wall: ['#e0c088', '#f7dfae'], line: '#c9a66a', roof: '#ec8f4e', roofLine: '#cf763a' }, // 노란 벽 + 주황 지붕
  { wall: ['#c98e6c', '#e3ab88'], line: '#b0775a', roof: '#8b5d49', roofLine: '#734a39' }, // 벽돌
  { wall: ['#bcd6c4', '#dcefe2'], line: '#a3c0ad', roof: '#6fb59a', roofLine: '#57a085' }, // 민트
];
/**
 * 바닥 고리(땅 좌표)를 높이 h만큼 올린 블록. 보이는 벽(남·동쪽을 보는 면)을 뒤에서 앞으로 그리고 지붕을 얹습니다.
 * 벽에는 층 줄을 긋습니다.
 */
function extrude(ringG, h, pal, z0 = 0) {
  let ring = ringG.slice();
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  let area = 0;
  for (let n = 0; n < ring.length; n++) {
    const [ax, ay] = ring[n];
    const [bx, by] = ring[(n + 1) % ring.length];
    area += ax * by - bx * ay;
  }
  if (area < 0) ring.reverse(); // 화면 기준 시계 방향으로
  const walls = [];
  for (let n = 0; n < ring.length; n++) {
    const a = ring[n];
    const b = ring[(n + 1) % ring.length];
    const nx = b[1] - a[1];
    const ny = -(b[0] - a[0]);
    if (nx + ny <= 0.01) continue; // 뒤쪽 면
    const len = Math.hypot(nx, ny);
    let d = `M${pt(iso(a[0], a[1], z0))}L${pt(iso(b[0], b[1], z0))}L${pt(iso(b[0], b[1], z0 + h))}L${pt(iso(a[0], a[1], z0 + h))}Z`;
    if (len > 5) for (let z = 6; z < h - 2; z += 6) d += `M${pt(iso(a[0], a[1], z0 + z))}L${pt(iso(b[0], b[1], z0 + z))}`;
    walls.push({ depth: a[0] + a[1] + b[0] + b[1], svg: `<path d="${d}" fill="${pal.wall[nx >= ny ? 1 : 0]}" stroke="${pal.line}" stroke-width=".6" stroke-linejoin="round"/>` });
  }
  walls.sort((p, q) => p.depth - q.depth);
  const roof = `<path d="M${ring.map(([x, y]) => pt(iso(x, y, z0 + h))).join('L')}Z" fill="${pal.roof}" stroke="${pal.roofLine}" stroke-width=".7" stroke-linejoin="round"/>`;
  return walls.map((w) => w.svg).join('') + roof;
}
const BUILDING_H = { apartments: [30, 48], commercial: [14, 24], retail: [12, 18], school: [12, 16], public: [12, 16], industrial: [10, 14], residential: [10, 15], parking: [8, 10] };

/** 뒤에서 앞으로 그릴 것들: { depth: (동 + 남) / 칸, svg } */
const things = [];
const buildingBoxes = [];
osm.buildings.forEach((b, n) => {
  for (const rings of polysOf(b.geom)) {
    const simple = turf.simplify(turf.polygon([rings[0]]), { tolerance: 0.000018, highQuality: true }).geometry.coordinates[0];
    const ring = simple.map(([lng, lat]) => ground(lng, lat));
    const area = turf.area(turf.polygon([rings[0]]));
    const r = hash(n, 5, 3);
    let h;
    let pal;
    if (b.tags.amenity === 'shelter') {
      h = 6;
      pal = PALETTES[3];
    } else {
      const range = BUILDING_H[b.tags.building] ?? (area < 130 ? [8, 11] : area < 500 ? [12, 20] : [16, 26]);
      h = Math.round(range[0] + r * (range[1] - range[0]));
      pal = b.tags.building === 'apartments' ? PALETTES[r < 0.6 ? 0 : 1] : PALETTES[[2, 3, 4, 0, 1, 2][Math.floor(hash(n, 9, 4) * 6)]];
    }
    const depths = ring.map(([x, y]) => (x + y) / C);
    const xs = ring.map(([x, y]) => iso(x, y)[0]);
    const ys = ring.map(([x, y]) => iso(x, y)[1]);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const box = { dMin: Math.min(...depths), dMax: Math.max(...depths), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - h, y1: Math.max(...ys) };
    if (box.x1 < -20 || box.x0 > W + 20 || box.y1 < -20 || box.y0 > H + 20) continue;
    buildingBoxes.push(box);
    things.push({ depth: (cx + cy) / C, svg: extrude(ring, h, pal) });
  }
  // 건물 칸과 그 둘레에는 나무를 두지 않습니다.
  fillGeom(b.geom, (i, j) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inGrid(i + di, j + dj)) occ[idx(i + di, j + dj)] = 1;
  });
});

// ---------- 꾸밈 마을(자료 범위 밖): 격자에 맞춘 상자 건물 ----------
const BOXES = [
  [16, 12, 9, 2], [20, 14, 12, 3], [14, 20, 11, 4], [22, 22, 16, 2], [18, 28, 30, 0], [28, 16, 36, 0], [22, 22, 42, 1], [26, 14, 22, 1], [16, 16, 13, 3], [24, 12, 10, 4],
];
BOXES.forEach(([w, d, h, p], n) => {
  defs.push(`<g id="b${n}">${extrude([[0, 0], [w, 0], [w, d], [0, d]], h, PALETTES[p]).replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${n1(Number(x) + X0)},${n1(Number(y) + Y0)}`)}</g>`);
});
for (let bj = Math.floor(J0 / 4) * 4; bj < J0 + NJ; bj += 4) {
  for (let bi = Math.floor(I0 / 4) * 4; bi < I0 + NI; bi += 4) {
    let free = true;
    for (let dj = 0; dj < 4 && free; dj++) for (let di = 0; di < 4 && free; di++) free = T(bi + di, bj + dj) === TOWN && !real[idx(bi + di, bj + dj)];
    if (!free) continue;
    const r = hash(bi, bj, 7);
    if (r > 0.56) continue;
    const tall = noise(bi * C, bj * C, 420, 9) > 0.56;
    const pool = tall ? [4, 5, 6, 7] : [0, 1, 2, 3, 8, 9];
    const n = pool[Math.floor(hash(bi, bj, 8) * pool.length)];
    const [w, d] = BOXES[n];
    const gx = bi * C + (40 - w) / 2;
    const gy = bj * C + (40 - d) / 2;
    const [x, y] = iso(gx, gy);
    things.push({ depth: (gx + w / 2 + gy + d / 2) / C, svg: `<use href="#b${n}" x="${n1(x)}" y="${n1(y)}"/>` });
    for (let dj = 0; dj < 4; dj++) for (let di = 0; di < 4; di++) occ[idx(bi + di, bj + dj)] = 1;
  }
}

// ---------- 나무·갈대·오리 ----------
const near = (i, j, list) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => list.includes(T(i + di, j + dj)));
const treeAt = (gx, gy, z, kinds, big) => {
  const [x, y] = iso(gx, gy, z);
  const depth = (gx + gy) / C;
  // 건물에 반쯤 가려 어색해지는 자리는 건너뜁니다(건물 앞뒤가 분명한 나무만 둠).
  if (buildingBoxes.some((b) => depth > b.dMin - 0.5 && depth < b.dMax + 0.5 && x > b.x0 - 8 && x < b.x1 + 8 && y > b.y0 - 4 && y < b.y1 + 26)) return;
  const k = kinds[Math.floor(hash(Math.round(gx), Math.round(gy), 31) * kinds.length)];
  const r = hash(Math.round(gx), Math.round(gy), 32);
  const size = big ? (r < 0.3 ? 2 : 3) : r < 0.35 ? 1 : r < 0.85 ? 2 : 3;
  things.push({ depth: depth + 0.001, svg: `<use href="#t${k}${size}" x="${n1(x)}" y="${n1(y)}"/>` });
};
let duckCount = 0;
const ducks = [];
const waterDecals = [];
for (let j = J0; j < J0 + NJ; j++) {
  for (let i = I0; i < I0 + NI; i++) {
    const t = T(i, j);
    if (!t) continue;
    const k = idx(i, j);
    const gx = (i + 0.2 + hash(i, j, 11) * 0.6) * C;
    const gy = (j + 0.2 + hash(i, j, 12) * 0.6) * C;
    const r = hash(i, j, 13);
    if (t === WOOD) {
      if (r < 0.6) treeAt(gx, gy, level[k] * ZS, ['c', 'k', 'c', 'r', 's', 'r'], true);
    } else if (t === WOODF) {
      if (r < 0.5) treeAt(gx, gy, 0, ['c', 'k', 'r', 's', 'r'], true);
    } else if (t === GRASS) {
      const lawn = !near(i, j, [PATH, ROAD, WATER, DECK, PITCH, PLAY]) && !occ[k];
      const clump = noise(gx, gy, 90, 3) > 0.6;
      if (lawn && r < (real[k] ? (clump ? 0.26 : 0.04) : 0.14)) treeAt(gx, gy, 0, ['r', 's', 'r', 's', 'c', 'y', 'o'], false);
      // 물가 갈대
      const water = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([di, dj]) => T(i + di, j + dj) === WATER);
      if (water && hash(i, j, 14) < 0.42) {
        const rx = (i + 0.5 + water[0] * 0.36) * C;
        const ry = (j + 0.5 + water[1] * 0.36) * C;
        const [x, y] = iso(rx, ry);
        things.push({ depth: (rx + ry) / C, svg: `<use href="#rd" x="${n1(x)}" y="${n1(y)}"/>` });
      }
    } else if (t === TOWN) {
      if (!occ[k] && !near(i, j, [ROAD, WATER]) && r < (real[k] ? 0.035 : 0.05)) treeAt(gx, gy, 0, ['r', 's', 'c'], false);
    } else if (t === WATER) {
      const shore = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([di, dj]) => {
        const n = T(i + di, j + dj);
        return n && n !== WATER;
      });
      const [x, y] = iso(gx, gy, WATER_Z);
      if (shore) {
        if (r < 0.07) waterDecals.push(`<use href="#lp" x="${n1(x)}" y="${n1(y)}"/>`);
      } else {
        if (r < 0.05) waterDecals.push(`<use href="#sp" x="${n1(x)}" y="${n1(y)}"/>`);
        // 오리: 물가에서 조금 떨어진 곳에, 서로 떨어져서
        let open = true;
        for (let dj = -2; dj <= 2 && open; dj++) for (let di = -2; di <= 2 && open; di++) open = T(i + di, j + dj) === WATER;
        if (open && real[k] && hash(i, j, 15) < 0.02 && !ducks.some((d) => Math.hypot(d[0] - gx, d[1] - gy) < 70) && duckCount < 16) {
          duckCount++;
          ducks.push([gx, gy]);
          things.push({ depth: (gx + gy) / C, svg: `<use href="#dk" ${hash(i, j, 16) < 0.5 ? `x="${n1(x)}" y="${n1(y)}"` : `transform="translate(${n1(x)} ${n1(y)}) scale(-1 1)"`}/>` });
        }
      }
    } else if (t === PLAY && hash(i, j, 17) < 0.3) {
      const [x, y] = iso((i + 0.5) * C, (j + 0.5) * C);
      things.push({ depth: i + j + 1, svg: `<use href="#pg" x="${n1(x)}" y="${n1(y)}"/>` });
    }
  }
}
if (osm.fountain) {
  const [gx, gy] = ground(osm.fountain.lon, osm.fountain.lat);
  const [x, y] = iso(gx, gy, WATER_Z);
  things.push({ depth: (gx + gy) / C, svg: `<use href="#ft" x="${n1(x)}" y="${n1(y)}"/>` });
}

// ---------- 숲 언덕: 대각선 줄(뒤→앞)마다 벽과 윗면 ----------
{
  const rows = new Map();
  for (let j = J0; j < J0 + NJ; j++) {
    for (let i = I0; i < I0 + NI; i++) {
      if (T(i, j) !== WOOD) continue;
      const z = zOf(i, j);
      const row = rows.get(i + j) ?? rows.set(i + j, { top: [[], [], []], left: [], right: [] }).get(i + j);
      const quad = (a, b, c, d) => `M${pt(a)}L${pt(b)}L${pt(c)}L${pt(d)}Z`;
      const east = T(i + 1, j) ? zOf(i + 1, j) : z;
      const south = T(i, j + 1) ? zOf(i, j + 1) : z;
      if (east < z) row.right.push(quad(V(i + 1, j, z), V(i + 1, j + 1, z), V(i + 1, j + 1, east), V(i + 1, j, east)));
      if (south < z) row.left.push(quad(V(i + 1, j + 1, z), V(i, j + 1, z), V(i, j + 1, south), V(i + 1, j + 1, south)));
      const [x, y] = V(i, j, z);
      const r = hash(i >> 1, j >> 1, 22);
      row.top[r < 0.24 ? 1 : r < 0.46 ? 2 : 0].push(`M${n1(x)},${n1(y)}l${C},${C / 2}-${C},${C / 2}-${C}-${C / 2}z`);
    }
  }
  for (const [d, row] of rows) {
    let svg = '';
    if (row.left.length) svg += `<path d="${row.left.join('')}" fill="${COL.soil[0]}"/>`;
    if (row.right.length) svg += `<path d="${row.right.join('')}" fill="${COL.soil[1]}"/>`;
    row.top.forEach((list, n) => {
      if (list.length) svg += `<path d="${list.join('')}" fill="${COL[WOOD][n]}" stroke="${COL[WOOD][n]}" stroke-width=".4"/>`;
    });
    things.push({ depth: d, svg });
  }
}

// ---------- 그리기 ----------
S.push(`<defs>${defs.join('')}</defs>`);
S.push(`<rect width="${W}" height="${H}" fill="${COL.base}"/>`);
// 물(한 단 아래) → 물가 벽 → 땅
S.push(`<path d="${regionD((i, j) => T(i, j) === WATER, WATER_Z)}" fill="${COL[WATER][0]}" fill-rule="evenodd"/>`);
shadeTiles(WATER, WATER_Z).forEach((list, n) => list.length && S.push(`<path d="${list.join('')}" fill="${COL[WATER][n + 1]}"/>`));
S.push(`<g>${waterDecals.join('')}</g>`);
{
  // 물가 벽: 같은 줄에서 이어지는 칸은 한 면으로 묶습니다.
  const walls = { soil: [[], []], stone: [[], []], wood: [[], []] };
  const quad = (a, b, c, d) => `M${pt(a)}L${pt(b)}L${pt(c)}L${pt(d)}Z`;
  const drop = (t) => (t === DECK ? -1.6 : WATER_Z);
  const land = (i, j) => {
    const t = T(i, j);
    return t && t !== WATER && t !== WOOD ? t : 0;
  };
  for (let i = I0; i < I0 + NI; i++) {
    for (let j = J0; j < J0 + NJ; j++) {
      const t = land(i, j);
      if (!t || T(i + 1, j) !== WATER) continue;
      let j2 = j;
      while (land(i, j2 + 1) && wallKind(land(i, j2 + 1)) === wallKind(t) && T(i + 1, j2 + 1) === WATER) j2++;
      walls[wallKind(t)][1].push(quad(V(i + 1, j, 0), V(i + 1, j2 + 1, 0), V(i + 1, j2 + 1, drop(t)), V(i + 1, j, drop(t))));
      j = j2;
    }
  }
  for (let j = J0; j < J0 + NJ; j++) {
    for (let i = I0; i < I0 + NI; i++) {
      const t = land(i, j);
      if (!t || T(i, j + 1) !== WATER) continue;
      let i2 = i;
      while (land(i2 + 1, j) && wallKind(land(i2 + 1, j)) === wallKind(t) && T(i2 + 1, j + 1) === WATER) i2++;
      walls[wallKind(t)][0].push(quad(V(i2 + 1, j + 1, 0), V(i, j + 1, 0), V(i, j + 1, drop(t)), V(i2 + 1, j + 1, drop(t))));
      i = i2;
    }
  }
  for (const [kind, [left, right]] of Object.entries(walls)) {
    if (left.length) S.push(`<path d="${left.join('')}" fill="${COL[kind][0]}"/>`);
    if (right.length) S.push(`<path d="${right.join('')}" fill="${COL[kind][1]}"/>`);
  }
}
for (const t of [TOWN, GRASS, WOODF, WOOD, ROAD, PITCH, PLAY, PATH, DECK]) {
  if (t === DECK) {
    const d = ribbons.map((line) => 'M' + line.map(([x, y]) => pt(iso(x, y))).join('L')).join('');
    S.push(`<g fill="none" stroke-linejoin="round" stroke-linecap="round"><path d="${d}" stroke="#d6bb7c" stroke-width="6.2"/><path d="${d}" stroke="#f7e6b8" stroke-width="4.4"/></g>`);
  }
  const d = regionD((i, j) => T(i, j) === t);
  if (!d) continue;
  const fill = t === WOOD ? COL.soil[0] : COL[t][0];
  // 같은 색 가는 테두리로 이웃 조각 사이 실금을 메웁니다.
  S.push(`<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width=".5" fill-rule="evenodd"/>`);
  if (t === TOWN || t === GRASS || t === WOODF) shadeTiles(t).forEach((list, n) => list.length && S.push(`<path d="${list.join('')}" fill="${COL[t][n + 1]}"/>`));
}
// 높은 것들: 뒤(북서)에서 앞(남동)으로
things.sort((a, b) => a.depth - b.depth);
S.push(`<g>${things.map((t) => t.svg).join('')}</g>`);
S.push('</svg>');
const svg = S.join('\n') + '\n';
writeFileSync(new URL('public/map/park-iso.svg', root), svg);
const webpPath = fileURLToPath(new URL('public/map/park-iso.webp', root));
await sharp(Buffer.from(svg)).webp({ quality: 90 }).toFile(webpPath);

// ---------- 콘텐츠: 좌표 변환 값 ----------
// 화면 좌표 = ((동 − 남) − x0, (동 + 남) / 2 − y0), 동 = (lng − lng0) × mLng, 남 = (lat0 − lat) × mLat  (src/lib/iso.ts)
content.map.iso = {
  image: '/map/park-iso.webp',
  width: W,
  height: H,
  lat0,
  lng0,
  mLat: M_LAT,
  mLng: M_LNG,
  x0: X0,
  y0: Y0,
  rev: createHash('sha1').update(readFileSync(webpPath)).digest('hex').slice(0, 8),
};
writeFileSync(contentUrl, JSON.stringify(content, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(\d+)\s+\]/g, '[$1, $2, $3]') + '\n');
const count = (t) => type.reduce((s, v) => s + (v === t ? 1 : 0), 0);
console.log(`park-iso.svg ${(svg.length / 1024).toFixed(0)}KB · 칸 ${type.reduce((s, v) => s + (v ? 1 : 0), 0)} (잔디 ${count(GRASS)}, 물 ${count(WATER)}, 길 ${count(PATH)}, 숲 ${count(WOOD)}) · 높은 것 ${things.length} · 건물 ${buildingBoxes.length} · 오리 ${duckCount}`);
