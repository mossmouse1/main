// 산책로(public/map/trails.json)와 종별 관찰 지점(v1.json taxa[].sightings)을 만듭니다.
//   입력: scripts/data/osm-dongtan.json(OSM 길), scripts/data/gbif-sightings.json(fetch-sightings.mjs)
//
// 관찰 지점 규칙
// 1) 정밀하지 않은 좌표는 뺍니다.
//    - eBird ‘핫스폿’ 대표점: 같은 좌표에 3종 이상이 찍힌 eBird 기록(새를 본 곳이 아니라 장소 대표 좌표)
//    - 위치 오차가 150m를 넘는 기록
// 2) 남은 기록은 가장 가까운 공원 산책로 위 점으로 옮깁니다(120m 안). 물새도 ‘보이는 물가 길’에 놓입니다.
// 3) 25m 안의 지점은 하나로 묶고 기록 수를 더합니다.
// 4) 정밀 기록이 없는 종은 단서 구역 안의 산책로에서 서로 떨어진 2~3곳을 ‘찾아볼 곳’(기록 수 0)으로 둡니다.
// 지도 데이터 © OpenStreetMap 기여자 (ODbL)
import { readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';

const root = new URL('..', import.meta.url);
const contentUrl = new URL('public/content/v1.json', root);
const content = JSON.parse(readFileSync(contentUrl, 'utf8'));
const { elements } = JSON.parse(readFileSync(new URL('scripts/data/osm-dongtan.json', root), 'utf8'));
const gbif = JSON.parse(readFileSync(new URL('scripts/data/gbif-sightings.json', root), 'utf8'));
const B = content.park.bounds;

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const M_LAT = 111_000;
const M_LNG = 111_000 * Math.cos((((B.north + B.south) / 2) * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LNG);

// ---------- 산책로 ----------
const PATH_KINDS = ['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track'];
const parkEl = elements.find((e) => e.type === 'relation' && e.tags?.leisure === 'park' && e.members?.length > 1 && e.bounds && e.bounds.minlat < B.north && e.bounds.maxlat > B.south);
const zoneF = (id) => turf.feature(content.zones.find((z) => z.id === id).geometry);
// 공원 = 구역 Z1~Z5(Z6은 공원 밖)
const parkArea = ['Z2', 'Z3', 'Z4', 'Z5'].map(zoneF);
const nearPark = turf.buffer(turf.featureCollection(parkArea.map((f) => turf.simplify(f, { tolerance: 0.00003 }))), 12, { units: 'meters' });
const inPark = (lat, lng) => nearPark.features.some((f) => turf.booleanPointInPolygon(turf.point([lng, lat]), f));

const lines = [];
for (const e of elements) {
  if (e.type !== 'way' || !e.geometry || !PATH_KINDS.includes(e.tags?.highway)) continue;
  // 공원 안에 든 연속 구간만 남깁니다(바깥 보도는 버림).
  let run = [];
  const flush = () => {
    if (run.length >= 2) lines.push(run);
    run = [];
  };
  for (const p of e.geometry) {
    if (p.lat > B.south && p.lat < B.north && p.lon > B.west && p.lon < B.east && inPark(p.lat, p.lon)) run.push({ lat: p.lat, lng: p.lon });
    else flush();
  }
  flush();
}
// OSM에는 호수 서·북쪽 물가길이 빠져 있어, 호수 바깥 테두리에서 10m 바깥 둘레를 ‘호숫가 길’로 보탭니다.
const lakeOuter = turf.polygon([content.zones.find((z) => z.id === 'Z1').geometry.coordinates[0]]);
const shoreRing = turf.buffer(lakeOuter, 10, { units: 'meters' }).geometry.coordinates[0];
lines.push(shoreRing.map(([lng, lat]) => ({ lat, lng })));

// 긴 구간은 15m 간격으로 점을 채워 ‘가장 가까운 점’ 계산이 매끄럽게 합니다.
const densify = (line) => {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const n = Math.ceil(dist(a, b) / 15);
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lng: a.lng + ((b.lng - a.lng) * k) / n });
  }
  return out;
};
const dense = lines.map(densify);
const trailPts = dense.flat();

/** 산책로 위 가장 가까운 점(선분 투영) */
function snap(p) {
  let best = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const ax = (a.lng - p.lng) * M_LNG;
      const ay = (a.lat - p.lat) * M_LAT;
      const bx = (b.lng - p.lng) * M_LNG;
      const by = (b.lat - p.lat) * M_LAT;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (!best || d < best.d) best = { d, lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
  }
  return best;
}

writeFileSync(
  new URL('public/map/trails.json', root),
  JSON.stringify({
    source: '지도 데이터 © OpenStreetMap 기여자',
    lines: lines.map((l) => l.map((p) => [r6(p.lat), r6(p.lng)])),
  }) + '\n',
);

// ---------- 관찰 지점 ----------
const hotspot = new Map();
for (const rows of Object.values(gbif.taxa)) {
  for (const r of rows) {
    if (r.src !== 'ebird') continue;
    const k = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    hotspot.set(k, (hotspot.get(k) ?? new Set()).add(rows));
  }
}
const isHotspot = (r) => r.src === 'ebird' && (hotspot.get(`${r.lat.toFixed(5)},${r.lng.toFixed(5)}`)?.size ?? 0) >= 3;

const SNAP_MAX_M = 120;
const LAKE_SNAP_MAX_M = 260;
const MERGE_M = 25;
// ‘찾아볼 곳’은 공원 가장자리(찻길 옆 보도)를 피합니다.
const edge = turf.buffer(zoneF('Z6'), 30, { units: 'meters' });
const awayFromEdge = (p) => !turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), edge);
const stats = { kept: 0, hotspot: 0, fuzzy: 0, far: 0 };

/** 단서 구역 산책로에서 서로 가장 먼 점 k개(같은 종은 늘 같은 자리) */
function suggestSpots(t, k) {
  const ids = t.clue.zoneIds.flatMap((z) => (z === 'Z1' ? ['Z2'] : [z]));
  const zones = [...new Set(ids)].map(zoneF);
  let pool = trailPts.filter((p) => awayFromEdge(p) && zones.some((f) => turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), f)));
  // 구역 안에 길이 없으면(숲 등) 구역에 가장 가까운 길 점들
  if (!pool.length) {
    const centers = zones.map((f) => turf.pointOnFeature(f).geometry.coordinates).map(([lng, lat]) => ({ lat, lng }));
    pool = trailPts
      .filter(awayFromEdge)
      .map((p) => ({ p, d: Math.min(...centers.map((c) => dist(p, c))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 60)
      .map((x) => x.p);
  }
  if (!pool.length) return [];
  let h = 0;
  for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const picks = [pool[h % pool.length]];
  while (picks.length < k) {
    let best = null;
    for (const p of pool) {
      const d = Math.min(...picks.map((q) => dist(p, q)));
      if (!best || d > best.d) best = { p, d };
    }
    if (!best || best.d < 60) break;
    picks.push(best.p);
  }
  return picks;
}

for (const t of content.taxa.filter((x) => !x.catalog)) {
  const rows = gbif.taxa[t.id] ?? [];
  const spots = [];
  for (const r of rows) {
    if (isHotspot(r)) {
      stats.hotspot++;
      continue;
    }
    if (r.unc != null && r.unc > 150) {
      stats.fuzzy++;
      continue;
    }
    const s = snap(r);
    // 호수 위 기록(물새)은 물가 길에서 멀어도 ‘보이는 물가’로 옮깁니다.
    const onLake = turf.booleanPointInPolygon(turf.point([r.lng, r.lat]), lakeOuter);
    if (!s || s.d > (onLake ? LAKE_SNAP_MAX_M : SNAP_MAX_M)) {
      stats.far++;
      continue;
    }
    stats.kept++;
    const near = spots.find((p) => dist(p, s) < MERGE_M);
    if (near) near.n++;
    else spots.push({ lat: s.lat, lng: s.lng, n: 1 });
  }
  let sightings;
  if (spots.length) {
    sightings = spots.sort((a, b) => b.n - a.n);
  } else {
    sightings = suggestSpots(t, t.category === 'tree' ? 3 : 2).map((p) => ({ ...p, n: 0 }));
  }
  t.sightings = sightings.map((p) => [r6(p.lat), r6(p.lng), p.n]);
  const top = sightings[0];
  t.pin = top
    ? { lat: r6(top.lat), lng: r6(top.lng), basis: top.n > 0 ? 'records' : 'clue-zone', records: sightings.reduce((s, p) => s + p.n, 0) }
    : t.pin ?? null;
}

// 지점 배열은 한 줄로(파일이 길어지지 않게)
const text = JSON.stringify(content, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(\d+)\s+\]/g, '[$1, $2, $3]');
writeFileSync(contentUrl, text + '\n');

const withRec = content.taxa.filter((t) => t.sightings?.some((s) => s[2] > 0));
console.log(`산책로 ${lines.length}구간 · 점 ${trailPts.length}`);
console.log(`기록: 산책로에 맞춤 ${stats.kept} · 핫스폿 대표점 제외 ${stats.hotspot} · 오차 큼 제외 ${stats.fuzzy} · 길에서 멂 ${stats.far}`);
console.log(`정밀 기록 있는 종 ${withRec.length} / ${content.taxa.filter((x) => !x.catalog).length}`);
for (const t of content.taxa.filter((x) => !x.catalog && !x.minor)) console.log(`  ${t.koreanName}: ${t.sightings.length}곳 (${t.sightings.map((s) => s[2]).join(',')})`);
