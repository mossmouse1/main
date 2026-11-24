// 종 카드에 들어갈 실제 자료를 받아 public/content/v1.json에 합칩니다.
//  - GBIF 공개 기록: 공원 중심 반경 1.5km, 2020년 이후 → 종별 월별 기록 수, 공원 주변 종 목록(‘목록에 없어요’ 검색)
//  - 위키데이터·위키미디어 커먼즈: 한국어 이름, 사진(CC0·CC BY·CC BY-SA만, 사진마다 저작자·이용 조건·원본 링크 저장)
// 받은 원자료는 scripts/data/species-data.json에 남깁니다. 다시 돌리면 최신 값으로 바뀝니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('..', import.meta.url);
const contentUrl = new URL('public/content/v1.json', root);
const photoDir = new URL('public/photos/', root);
const content = JSON.parse(readFileSync(contentUrl, 'utf8'));

const CENTER = '37.1687,127.10093';
const RADIUS = '1.5km';
const YEARS = '2020,2030';
const UA = { 'User-Agent': 'park-life-dex/0.1 (student project; Dongtan Lake Park citizen science)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 국내 이름과 국제 분류가 다른 종: 공원 주변 기록이 다른 학명으로 올라와 있어 합쳐 셉니다.
// (박새 Parus minor는 eBird·iNaturalist에서 Parus cinereus/major로 기록되는 경우가 많음)
const GBIF_ALIASES = { 'japanese-tit': ['Parus cinereus', 'Parus major'] };

// 카드에 쓰지 않을 사진: 세밀화·표본 도판, 새싹, 이름표, 콜라주, 성(城) 풍경 등
const EXCLUDE_FILE = /Addisonia|PLATE|_SZ\d|seedling|Birdwatching_sample|Castle|label|sign|herbarium|specimen|illustration|drawing|map/i;
const EXCLUDE_CREDIT = /Botanical Garden|Siebold|Köhler/i;

/** 429·5xx는 서버가 알려준 만큼(없으면 점점 길게) 기다렸다가 다시 시도합니다. */
async function fetchPolitely(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
    if (res.ok) return res;
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url}`);
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
  }
}
const getJson = async (url, init) => (await fetchPolitely(url, init)).json();

// ---------------- GBIF ----------------
const occ = (extra) => `https://api.gbif.org/v1/occurrence/search?geoDistance=${CENTER},${RADIUS}&year=${YEARS}&limit=0&${extra}`;

async function gbifMatch(name) {
  const m = await getJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`);
  if (!m.usageKey || m.matchType === 'NONE') return null;
  // 아종으로 맞으면 종 단위로 셉니다(기록 대부분이 종 이름으로 올라옴).
  return m.rank === 'SPECIES' ? (m.acceptedUsageKey ?? m.usageKey) : (m.speciesKey ?? m.usageKey);
}

async function monthCounts(taxonKeys) {
  const keys = taxonKeys.map((k) => `taxonKey=${k}`).join('&');
  const r = await getJson(occ(`${keys}&facet=month&facetLimit=20`));
  const months = Array(12).fill(0);
  for (const c of r.facets[0]?.counts ?? []) months[Number(c.name) - 1] = c.count;
  return { total: r.count, months };
}

// ---------------- 위키데이터·커먼즈 ----------------
async function wikidata(names) {
  const values = names.map((n) => JSON.stringify(n)).join(' ');
  const q = `SELECT ?name ?item ?ko ?img WHERE { VALUES ?name { ${values} } ?item wdt:P225 ?name .
    OPTIONAL { ?item rdfs:label ?ko FILTER(lang(?ko) = "ko") } OPTIONAL { ?item wdt:P18 ?img } }`;
  const r = await getJson('https://query.wikidata.org/sparql?format=json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: 'query=' + encodeURIComponent(q),
  });
  const out = new Map();
  for (const b of r.results.bindings) {
    const name = b.name.value;
    const e = out.get(name) ?? { qid: b.item.value.split('/').pop(), ko: null, images: [] };
    if (b.ko && !e.ko) e.ko = b.ko.value;
    if (b.img) {
      const file = decodeURIComponent(b.img.value.split('/Special:FilePath/')[1]).replace(/_/g, ' ');
      if (!e.images.includes(file)) e.images.push(file);
    }
    out.set(name, e);
  }
  return out;
}

/**
 * 위키데이터 대표 사진이 모자라면 커먼즈에서 더 찾습니다(‘이 종을 찍은’ P180 + 학명 검색).
 * 이 결과는 엉뚱한 종이 섞이므로 파일 이름에 속명이 들어간 것만 씁니다.
 */
async function moreFiles(qid, scientificName, limit) {
  const genus = scientificName.split(' ')[0].toLowerCase();
  const out = [];
  for (const q of [`haswbstatement:P180=${qid} filetype:bitmap`, `"${scientificName}" filetype:bitmap`]) {
    const r = await getJson(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=${limit}&format=json&srsearch=${encodeURIComponent(q)}`,
    );
    out.push(...(r.query?.search ?? []).map((s) => s.title.replace(/^File:/, '')).filter((f) => f.toLowerCase().includes(genus)));
    await sleep(1500);
  }
  return out;
}

const stripHtml = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function acceptLicense(short) {
  const s = (short ?? '').trim();
  if (/^(cc0|public domain|pd)/i.test(s)) return s.toUpperCase().startsWith('CC0') ? 'CC0' : 'Public domain';
  if (/^cc by(-sa)? \d/i.test(s) && !/nc|nd/i.test(s)) return s.toUpperCase().replace('CC BY', 'CC BY');
  return null; // NC·ND·GFDL 단독 등은 쓰지 않습니다.
}

async function imageInfo(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => `File:${f}`).join('|');
    const r = await getJson(
      `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=720&format=json&titles=${encodeURIComponent(titles)}`,
    );
    const normalized = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(r.query.pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata ?? {};
      const title = normalized.get(page.title) ?? page.title;
      out.set(title.replace(/^File:/, ''), {
        thumb: info.thumburl,
        mime: info.mime,
        width: info.width,
        height: info.height,
        license: acceptLicense(meta.LicenseShortName?.value),
        credit: stripHtml(meta.Artist?.value).slice(0, 80) || '작자 미상',
        sourceUrl: info.descriptionurl,
      });
    }
    await sleep(300);
  }
  return out;
}

/** 받은 사진은 긴 변 720px WebP로 줄여 둡니다(휴대폰 데이터 절약). */
async function download(url, dest) {
  const res = await fetchPolitely(url);
  await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(fileURLToPath(dest));
  await sleep(700);
}

// ---------------- 실행 ----------------
const raw = { fetchedAt: new Date().toISOString(), source: { gbif: { center: CENTER, radius: RADIUS, years: YEARS } }, taxa: {}, catalog: [] };

console.log('GBIF: 콘텐츠 종 월별 기록…');
for (const t of content.taxa.filter((x) => !x.catalog)) {
  const key = await gbifMatch(t.scientificName);
  const aliasKeys = [];
  for (const name of GBIF_ALIASES[t.id] ?? []) aliasKeys.push(await gbifMatch(name));
  const keys = [key, ...aliasKeys].filter(Boolean);
  const counts = keys.length ? await monthCounts(keys) : { total: 0, months: Array(12).fill(0) };
  raw.taxa[t.id] = { gbifKey: key, gbifAliasKeys: aliasKeys.filter(Boolean), ...counts };
  await sleep(120);
}

console.log('GBIF: 공원 주변 종 목록…');
const facet = await getJson(occ('facet=speciesKey&facetLimit=1000'));
const known = new Set(Object.values(raw.taxa).flatMap((x) => [x.gbifKey, ...x.gbifAliasKeys]).filter(Boolean));
for (const c of facet.facets[0]?.counts ?? []) {
  const key = Number(c.name);
  if (known.has(key)) continue;
  const s = await getJson(`https://api.gbif.org/v1/species/${key}`);
  if (!s.canonicalName) continue;
  raw.catalog.push({ gbifKey: key, scientificName: s.canonicalName, kingdom: s.kingdom, class: s.class, order: s.order, count: c.count });
  await sleep(80);
}

console.log('위키데이터: 한국어 이름·사진…');
const names = [...content.taxa.filter((x) => !x.catalog).map((t) => t.scientificName), ...raw.catalog.map((c) => c.scientificName)];
const wd = new Map();
for (let i = 0; i < names.length; i += 80) {
  for (const [k, v] of await wikidata(names.slice(i, i + 80))) wd.set(k, v);
  await sleep(500);
}

// 콘텐츠 종: 주요 종은 사진 3장, 나머지 1장
const wanted = new Map();
for (const t of content.taxa.filter((x) => !x.catalog)) {
  if (t.publicObservations?.length && t.photo) continue;
  const w = wd.get(t.scientificName);
  if (!w) continue;
  const need = t.minor ? 1 : 3;
  let files = w.images.filter((f) => !EXCLUDE_FILE.test(f));
  if (files.length < need + 2) files = [...files, ...(await moreFiles(w.qid, t.scientificName, 15)).filter((f) => !files.includes(f) && !EXCLUDE_FILE.test(f))];
  wanted.set(t.id, { files, need });
}
const info = await imageInfo([...new Set([...wanted.values()].flatMap((w) => w.files))]);

mkdirSync(photoDir, { recursive: true });
console.log('커먼즈: 사진 받기…');
for (const [id, { files, need }] of wanted) {
  const picks = files
    .map((f) => ({ file: f, ...info.get(f) }))
    .filter((p) => p.thumb && p.license && !EXCLUDE_CREDIT.test(p.credit) && /jpeg|webp/.test(p.mime ?? '') && p.width >= 640)
    .slice(0, need);
  raw.taxa[id].photos = [];
  for (const [n, p] of picks.entries()) {
    const name = `${id}-${n + 1}.webp`;
    await download(p.thumb, new URL(name, photoDir));
    raw.taxa[id].photos.push({ src: `/photos/${name}`, credit: p.credit, license: p.license, sourceUrl: p.sourceUrl });
  }
}

mkdirSync(new URL('scripts/data/', root), { recursive: true });
writeFileSync(new URL('scripts/data/species-data.json', root), JSON.stringify({ ...raw, wikidata: Object.fromEntries(wd) }, null, 1));

// ---------------- 콘텐츠에 합치기 ----------------
const birdWaterOrders = new Set(['Anseriformes', 'Gruiformes', 'Podicipediformes', 'Pelecaniformes', 'Charadriiformes', 'Suliformes', 'Ciconiiformes', 'Gaviiformes']);
const category = (c) => (c.class === 'Aves' ? (birdWaterOrders.has(c.order) ? 'waterbird' : 'townbird') : 'other');

const previousCatalog = new Map(content.taxa.filter((t) => t.catalog).map((t) => [t.id, t]));
content.taxa = content.taxa.filter((t) => !t.catalog);
for (const t of content.taxa) {
  const r = raw.taxa[t.id];
  t.monthCounts = r.months;
  t.recordCount = r.total;
  if (r.photos?.length) {
    t.photos = r.photos;
    t.photo = r.photos[0];
  }
}
const usedNames = new Set([...content.taxa, ...previousCatalog.values()].map((t) => t.koreanName));
for (const c of raw.catalog.sort((a, b) => b.count - a.count)) {
  const id = `gbif-${c.gbifKey}`;
  const existing = previousCatalog.get(id);
  if (existing) {
    content.taxa.push({ ...existing, recordCount: c.count });
    previousCatalog.delete(id);
    continue;
  }
  const ko = wd.get(c.scientificName)?.ko;
  const koreanName = ko && /[가-힣]/.test(ko) && !usedNames.has(ko) ? ko : null;
  content.taxa.push({
    id,
    koreanName: koreanName ?? c.scientificName,
    scientificName: c.scientificName,
    category: category(c),
    confusableIds: [],
    confusableStatus: 'draft',
    clue: { zoneIds: [], where: '', looks: [] },
    monthCounts: null,
    recordCount: c.count,
    photo: null,
    photos: [],
    cultivated: false,
    minor: true,
    catalog: true,
  });
  if (koreanName) usedNames.add(koreanName);
}
content.taxa.push(...previousCatalog.values());
content.monthCounts = {
  basis: '2020년 이후, 공원 중심 반경 1.5km',
  source: 'GBIF 공개 기록(iNaturalist·eBird 등)',
  fetchedAt: raw.fetchedAt.slice(0, 10),
};
content.placeholders = content.placeholders.filter((p) => !/monthCounts|photo/.test(p));
writeFileSync(contentUrl, JSON.stringify(content, null, 2) + '\n');

const withPhoto = content.taxa.filter((t) => t.photo).length;
const main = content.taxa.filter((t) => !t.catalog);
console.log(`완료: 콘텐츠 종 ${main.length}(사진 ${withPhoto}), 주변 종 목록 ${raw.catalog.length}, 사진 파일 ${main.reduce((n, t) => n + t.photos.length, 0)}장`);
for (const t of main) if (!t.photo) console.log(`  사진 없음: ${t.koreanName} (${t.scientificName})`);
