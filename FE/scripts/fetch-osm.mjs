// 그림 지도 범위의 OpenStreetMap 데이터를 받아 scripts/data/osm-dongtan.json에 둡니다.
// 지도 데이터 © OpenStreetMap 기여자 (ODbL). 앱 지도에 출처를 표기합니다.
import { mkdirSync, writeFileSync } from 'node:fs';

const B = { south: 37.16293, west: 127.09493, north: 37.17447, east: 127.10693 };
const pad = 0.0015;
const bbox = `${B.south - pad},${B.west - pad},${B.north + pad},${B.east + pad}`;
const query = `[out:json][timeout:180];(nwr(${bbox}););out geom;`;

const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let json;
for (const url of endpoints) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'park-life-dex/0.1 (student project)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    json = await res.json();
    break;
  } catch (err) {
    console.warn(`${url} 실패: ${err.message}`);
  }
}
if (!json) throw new Error('OSM 데이터를 받지 못했어요');

mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
writeFileSync(new URL('./data/osm-dongtan.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), bbox, elements: json.elements }));
console.log(`요소 ${json.elements.length}개 저장`);
