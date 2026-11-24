// 종 전체의 외래종·보호 구분 대조표 CSV(팀이 공식 목록과 대조). 실행: npm run status:csv
import { readFileSync, writeFileSync } from 'node:fs';

const content = JSON.parse(readFileSync(new URL('../public/content/v1.json', import.meta.url), 'utf8'));
const status = JSON.parse(readFileSync(new URL('../src/admin/taxon-status.json', import.meta.url), 'utf8'));
const q = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const lines = [['종 ID', '국명', '학명', '외래종(생태계교란 생물)', '보호 구분', '근거 출처', '검증 여부', '공식 목록 대조 결과(팀 기입)']];
for (const t of content.taxa) {
  const s = status[t.id] ?? {};
  lines.push([t.id, t.koreanName, t.scientificName, s.alien ? '예' : '', s.protection ?? '', s.source ?? '', s.verified ? '검증됨' : '검증 전', '']);
}
const out = new URL('../../docs/종_상태_대조표.csv', import.meta.url);
writeFileSync(out, '﻿' + lines.map((l) => l.map(q).join(',')).join('\r\n') + '\r\n');
console.log(`${content.taxa.length}종 -> docs/종_상태_대조표.csv`);
