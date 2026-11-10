// FE/public/content/v1.json → BE/supabase/seed.sql
// 콘텐츠는 JSON 한 곳에서 고치고, 서버의 구역·비오톱 판정과 내보내기용 종 이름은 이 시드로 맞춥니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const content = JSON.parse(readFileSync(new URL('public/content/v1.json', root), 'utf8'));

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => (a?.length ? `array[${a.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const json = (v) => (v == null ? 'null' : `${q(JSON.stringify(v))}::jsonb`);
const geom = (g) => `extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(${q(JSON.stringify(g))}), 4326))`;

const lines = [
  `-- 자동 생성: npm run seed:sql (${content.updatedAt}, 콘텐츠 v${content.version}). 직접 고치지 마세요.`,
  'begin;',
  '',
  '-- 조사구역(배열 순서 = 판정 우선순위)',
];
content.zones.forEach((z, i) => {
  lines.push(
    `insert into public.zones (id, name, description, priority, geom, placeholder) values (${q(z.id)}, ${q(z.name)}, ${q(z.description)}, ${i + 1}, ${geom(z.geometry)}, ${!!z.placeholder})`,
    `  on conflict (id) do update set name = excluded.name, description = excluded.description, priority = excluded.priority, geom = excluded.geom, placeholder = excluded.placeholder;`,
  );
});

lines.push('', '-- 비오톱 도형(통째로 바꿈)', 'delete from public.biotopes;');
for (const b of content.biotopes) {
  lines.push(
    `insert into public.biotopes (code, name, year, source, geom, placeholder) values (${q(b.code)}, ${q(b.name)}, ${b.year}, ${q(b.source)}, ${geom(b.geometry)}, ${!!b.placeholder});`,
  );
}

lines.push('', '-- 종');
for (const t of content.taxa) {
  lines.push(
    `insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values (${q(t.id)}, ${q(t.koreanName)}, ${q(t.scientificName)}, ${q(t.category)}, ${arr(t.confusableIds)}, ${json(t.clue)}, ${t.monthCounts ? `array[${t.monthCounts.join(', ')}]::integer[]` : 'null'}, ${json(t.photo)}, ${q(t.photo?.license)}, ${!!t.cultivated}, ${!!t.minor})`,
    `  on conflict (id) do update set korean_name = excluded.korean_name, scientific_name = excluded.scientific_name, category = excluded.category, confusable_ids = excluded.confusable_ids, clue = excluded.clue, month_counts = excluded.month_counts, photo = excluded.photo, photo_license = excluded.photo_license, cultivated = excluded.cultivated, minor = excluded.minor;`,
  );
}

lines.push('', '-- 계절 세트');
for (const s of content.seasonSets) {
  lines.push(
    `insert into public.season_sets (id, season, label, starts_on, ends_on, today_six, dex) values (${q(s.id)}, ${q(s.season)}, ${q(s.label)}, ${q(s.startsOn)}, ${q(s.endsOn)}, ${arr(s.todaySix)}, ${arr(s.dex)})`,
    `  on conflict (id) do update set season = excluded.season, label = excluded.label, starts_on = excluded.starts_on, ends_on = excluded.ends_on, today_six = excluded.today_six, dex = excluded.dex;`,
  );
}

lines.push('', 'commit;', '');
const out = fileURLToPath(new URL('../BE/supabase/seed.sql', root));
writeFileSync(out, lines.join('\n'));
console.log(`seed.sql: 구역 ${content.zones.length}, 비오톱 ${content.biotopes.length}, 종 ${content.taxa.length}, 세트 ${content.seasonSets.length}`);
