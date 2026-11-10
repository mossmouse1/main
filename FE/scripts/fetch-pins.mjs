// 지도 생물 핀 위치: 종마다 GBIF 공개 기록 좌표(2020년 이후, 반경 1.5km) 중 그림 지도 안의 기록을 모아
// 가장 많이 기록된 곳(기록들의 중앙점, medoid)에 핀을 둡니다. 지도 안 기록이 없으면 단서 구역 중심을 씁니다.
// PRD 8장: 지도에는 다른 가족의 기록이 아니라 공개 기록 기반의 생물 핀만 보여 줍니다.
import { readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';

const root = new URL('..', import.meta.url);
const contentUrl = new URL('public/content/v1.json', root);
const content = JSON.parse(readFileSync(contentUrl, 'utf8'));
const data = JSON.parse(readFileSync(new URL('scripts/data/species-data.json', root), 'utf8'));
const B = content.park.bounds;
const UA = { 'User-Agent': 'park-life-dex/0.1 (student project)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 88700);

for (const t of content.taxa.filter((x) => !x.catalog)) {
  const raw = data.taxa[t.id];
  const keys = [raw?.gbifKey, ...(raw?.gbifAliasKeys ?? [])].filter(Boolean);
  let points = [];
  if (keys.length) {
    const url = `https://api.gbif.org/v1/occurrence/search?${keys.map((k) => `taxonKey=${k}`).join('&')}&decimalLatitude=${B.south},${B.north}&decimalLongitude=${B.west},${B.east}&year=2020,2030&limit=300&hasCoordinate=true`;
    const res = await fetch(url, { headers: UA });
    const json = await res.json();
    points = (json.results ?? []).map((o) => [o.decimalLatitude, o.decimalLongitude]);
    await sleep(150);
  }
  const zone = content.zones.find((z) => z.id === t.clue.zoneIds[0]);
  if (points.length) {
    const medoid = points.reduce((best, p) => {
      const s = points.reduce((acc, q) => acc + dist(p, q), 0);
      return s < best.s ? { p, s } : best;
    }, { p: points[0], s: Infinity }).p;
    t.pin = { lat: r6(medoid[0]), lng: r6(medoid[1]), basis: 'records', records: points.length };
  } else if (zone) {
    t.pin = { lat: zone.center[0], lng: zone.center[1], basis: 'clue-zone', records: 0 };
  } else {
    t.pin = null;
  }
}

// 핀이 겹치지 않게: 45m보다 가까운 핀은 구역 안에서 서로 조금씩 밀어냅니다(같은 관찰 지점에 기록이 몰린 경우 등).
const MIN_GAP_M = 70;
const placed = [];
const zoneOf = (p) => content.zones.find((z) => turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), z.geometry));
for (const t of content.taxa.filter((x) => !x.catalog && x.pin)) {
  const home = zoneOf(t.pin);
  let best = t.pin;
  for (let ring = 0; ring < 8 && placed.some((p) => dist([p.lat, p.lng], [best.lat, best.lng]) < MIN_GAP_M); ring++) {
    for (let k = 0; k < 8; k++) {
      const a = ((k + ring * 0.5) / 8) * 2 * Math.PI;
      const r = MIN_GAP_M * (ring + 1);
      const cand = { lat: t.pin.lat + (r * Math.sin(a)) / 111000, lng: t.pin.lng + (r * Math.cos(a)) / 88700 };
      const sameZone = !home || zoneOf(cand)?.id === home.id;
      if (sameZone && !placed.some((p) => dist([p.lat, p.lng], [cand.lat, cand.lng]) < MIN_GAP_M)) {
        best = cand;
        break;
      }
    }
  }
  t.pin = { ...t.pin, lat: r6(best.lat), lng: r6(best.lng) };
  placed.push(t.pin);
}
writeFileSync(contentUrl, JSON.stringify(content, null, 2) + '\n');
for (const t of content.taxa.filter((x) => !x.catalog && !x.minor)) console.log(`${t.koreanName}: ${t.pin?.basis} ${t.pin?.records ?? 0}건`);
