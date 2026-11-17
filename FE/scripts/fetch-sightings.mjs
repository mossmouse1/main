// 지도 관찰 지점 원자료: 종마다 GBIF 공개 기록 좌표(2020년 이후, 그림 지도 범위)를 모두 받아
// scripts/data/gbif-sightings.json에 둡니다. 가공(산책로 맞추기·묶기)은 build-sightings.mjs가 합니다.
// PRD 8장: 지도에는 다른 가족의 기록이 아니라 공개 기록 기반의 생물 위치만 보여 줍니다.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const content = JSON.parse(readFileSync(new URL('public/content/v1.json', root), 'utf8'));
const data = JSON.parse(readFileSync(new URL('scripts/data/species-data.json', root), 'utf8'));
const B = content.park.bounds;
const UA = { 'User-Agent': 'park-life-dex/0.1 (student project)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { fetchedAt: new Date().toISOString(), source: 'GBIF occurrence search (2020~, hasCoordinate)', taxa: {} };
for (const t of content.taxa.filter((x) => !x.catalog)) {
  const raw = data.taxa[t.id];
  const keys = [raw?.gbifKey, ...(raw?.gbifAliasKeys ?? [])].filter(Boolean);
  if (!keys.length) continue;
  const rows = [];
  for (let offset = 0; offset < 900; offset += 300) {
    const url = `https://api.gbif.org/v1/occurrence/search?${keys.map((k) => `taxonKey=${k}`).join('&')}&decimalLatitude=${B.south},${B.north}&decimalLongitude=${B.west},${B.east}&year=2020,2030&limit=300&offset=${offset}&hasCoordinate=true`;
    const json = await (await fetch(url, { headers: UA })).json();
    for (const o of json.results ?? []) {
      rows.push({
        lat: o.decimalLatitude,
        lng: o.decimalLongitude,
        unc: o.coordinateUncertaintyInMeters ?? null,
        src: o.datasetKey === '4fa7b334-ce0d-4e88-aaae-2e0c138d049e' ? 'ebird' : /inaturalist/i.test(o.datasetName ?? '') ? 'inat' : (o.institutionCode ?? 'etc'),
        date: (o.eventDate ?? '').slice(0, 10),
        month: o.month ?? null,
      });
    }
    await sleep(150);
    if (json.endOfRecords) break;
  }
  out.taxa[t.id] = rows;
  console.log(`${t.koreanName}: ${rows.length}건`);
}
writeFileSync(new URL('scripts/data/gbif-sightings.json', root), JSON.stringify(out) + '\n');
