// Refresh the public observation layer without changing the walking-guide content.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { booleanPointInPolygon, polygon } from '@turf/turf';

const { values } = parseArgs({ options: { gbif: { type: 'string' }, inat: { type: 'string' } } });
const contentUrl = new URL('../public/content/v1.json', import.meta.url);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const content = read(contentUrl);
const { elements } = read(new URL('./data/osm-dongtan.json', import.meta.url));
const names = read(new URL('./data/species-data.json', import.meta.url));
const { south, west, north, east } = content.park.bounds;
const park = elements.find((row) => row.type === 'relation' && row.id === 17419957);
// This OSM relation has two outer ways that form one closed ring.
const boundary = polygon([park.members.flatMap((way, i) => way.geometry.slice(i ? 1 : 0).map(({ lon, lat }) => [lon, lat]))]);
const inPark = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= south && lat <= north && lng >= west && lng <= east
  && booleanPointInPolygon([lng, lat], boundary);

async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not load public observations: ${url}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function pages(url, limit, cached) {
  if (cached) {
    const response = read(cached);
    if (response.results.length !== (response.count ?? response.total_results)) throw new Error(`Incomplete snapshot: ${cached}`);
    return response.results;
  }
  const rows = [];
  while (true) {
    const response = await fetchJson(url(rows.length, rows.length / limit + 1));
    rows.push(...response.results);
    if (rows.length >= (response.count ?? response.total_results)) return rows;
    if (response.results.length !== limit) throw new Error('Incomplete observation query');
  }
}

const [gbif, inat] = await Promise.all([
  pages((offset) => `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${south},${north}&decimalLongitude=${west},${east}&limit=100&hasCoordinate=true&offset=${offset}`, 100, values.gbif),
  pages((_, page) => `https://api.inaturalist.org/v1/observations?swlat=${south}&swlng=${west}&nelat=${north}&nelng=${east}&per_page=200&locale=ko&page=${page}`, 200, values.inat),
]);

const byId = new Map(content.taxa.map((taxon) => [taxon.id, taxon]));
const byScientific = new Map(content.taxa.map((taxon) => [taxon.scientificName, taxon]));
const byGbif = new Map();
for (const [id, data] of Object.entries(names.taxa)) {
  for (const key of [data.gbifKey, ...(data.gbifAliasKeys ?? [])]) {
    if (key && byId.has(id)) byGbif.set(key, byId.get(id));
  }
}
for (const taxon of content.taxa) {
  delete taxon.publicObservations;
  if (taxon.id.startsWith('gbif-')) byGbif.set(Number(taxon.id.slice(5)), taxon);
}

const seen = new Set();
function add({ id, gbifKey, scientific, korean, bird, cultivated = false, record }) {
  if (!scientific || !record.date || seen.has(record.id)) return;
  const existing = byGbif.get(gbifKey) ?? byScientific.get(scientific) ?? byId.get(id);
  const taxon = existing ?? {
    id,
    koreanName: korean || scientific,
    scientificName: scientific,
    category: bird ? 'townbird' : 'other',
    confusableIds: [],
    confusableStatus: 'draft',
    clue: { zoneIds: [], where: '', looks: [] },
    monthCounts: null,
    photo: null,
    photos: [],
    cultivated,
    minor: true,
    catalog: true,
  };
  if (!existing) {
    content.taxa.push(taxon);
    byId.set(id, taxon);
    byScientific.set(scientific, taxon);
  } else if (korean && taxon.koreanName === taxon.scientificName) {
    taxon.koreanName = korean;
  }
  if (gbifKey) byGbif.set(gbifKey, taxon);
  (taxon.publicObservations ??= []).push(record);
  seen.add(record.id);
}

const observing = new Map(inat.map((row) => [String(row.id), row]));
const koreanName = (value) => typeof value === 'string' && /[가-힣]/.test(value) ? value : null;
const coordinate = (lat, lng, uncertainty) => ({
  lat: Number(lat.toFixed(6)),
  lng: Number(lng.toFixed(6)),
  ...(Number.isFinite(uncertainty) && { uncertaintyM: Math.round(uncertainty) }),
});
const surveyData = read(new URL('./data/dongtan-survey.json', import.meta.url));
const sources = {
  iNaturalist: 'iNaturalist',
  NATURING: '네이처링 · GBIF',
  NSMK: '국립중앙과학관 · GBIF',
  NIEK: '국립생태원 · GBIF',
  CLO: 'eBird · GBIF',
  '6ff8b3b0-ef0f-4f79-a310-5a5615c6aa0b': 'Birda · GBIF',
};
const publicLicense = (url) => /creativecommons\.org\/(?:licenses\/by(?:-nc)?|publicdomain\/zero)\//.test(url ?? '');

for (const row of gbif) {
  const { decimalLatitude: lat, decimalLongitude: lng, coordinateUncertaintyInMeters: uncertainty } = row;
  if (!inPark(lat, lng) || !publicLicense(row.license) || !row.speciesKey || !row.species
    || !['HUMAN_OBSERVATION', 'OBSERVATION', 'MATERIAL_SAMPLE', 'PRESERVED_SPECIMEN'].includes(row.basisOfRecord)
    || !['PRESENT', 'DETECTED'].includes(row.occurrenceStatus)) continue;
  const origin = row.occurrenceID?.match(/^https?:\/\/(?:www\.)?inaturalist\.org\/observations\/(\d+)/)?.[1];
  const direct = origin && observing.get(origin);
  if (origin && (!direct || direct.obscured || direct.geoprivacy || direct.taxon_geoprivacy || direct.quality_grade !== 'research'
    || !['cc0', 'cc-by', 'cc-by-nc'].includes(direct.license_code)
    || (direct.public_positional_accuracy ?? direct.positional_accuracy) > 100)) continue;
  const isChecklist = row.institutionCode === 'CLO';
  if (!isChecklist && (uncertainty > 100 || row.dataGeneralizations || row.informationWithheld)) continue;
  add({
    id: `gbif-${row.speciesKey}`, gbifKey: row.speciesKey, scientific: row.species,
    korean: koreanName(direct?.taxon?.preferred_common_name) ?? koreanName(row.vernacularName),
    bird: row.class === 'Aves',
    record: {
      id: origin ? `inat:${origin}` : `gbif:${row.key}`,
      date: (row.eventDate ?? '').slice(0, 10),
      source: sources[row.institutionCode] ?? sources[row.datasetKey] ?? 'GBIF',
      url: origin ? `https://www.inaturalist.org/observations/${origin}` : `https://www.gbif.org/occurrence/${row.key}`,
      license: row.license,
      ...(direct?.user?.login || row.recordedBy ? { credit: direct?.user?.login || row.recordedBy } : {}),
      ...(isChecklist ? { area: '동탄호수공원 일대 · eBird 체크리스트' } : coordinate(lat, lng, uncertainty)),
    },
  });
}

for (const row of inat) {
  const [lat, lng] = (row.location ?? '').split(',').map(Number);
  const uncertainty = row.public_positional_accuracy ?? row.positional_accuracy;
  if (!inPark(lat, lng) || row.quality_grade !== 'research' || row.taxon?.rank !== 'species'
    || !['cc0', 'cc-by', 'cc-by-nc'].includes(row.license_code)
    || row.obscured || row.geoprivacy || row.taxon_geoprivacy || uncertainty > 100) continue;
  add({
    id: `inat-${row.taxon.id}`, scientific: row.taxon.name,
    korean: koreanName(row.taxon.preferred_common_name), bird: row.taxon.iconic_taxon_name === 'Aves',
    record: {
      id: `inat:${row.id}`, date: row.observed_on, source: 'iNaturalist',
      url: `https://www.inaturalist.org/observations/${row.id}`,
      license: row.license_code === 'cc0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : `https://creativecommons.org/licenses/${row.license_code.slice(3)}/4.0/`,
      ...(row.user?.login && { credit: row.user.login }),
      ...coordinate(lat, lng, uncertainty),
    },
  });
}

for (const row of surveyData) {
  if ('lat' in row.record && !inPark(row.record.lat, row.record.lng)) continue;
  add(row);
}

const withRecords = content.taxa.filter((taxon) => taxon.publicObservations?.length);
for (const taxon of withRecords) taxon.publicObservations.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
const records = withRecords.flatMap((taxon) => taxon.publicObservations);
content.publicObservationsUpdatedOn = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
// Keep the compact legacy wayfinding tuples in the same format as build-sightings.mjs.
const serialized = JSON.stringify(content, null, 2).replace(/("sightings": \[\n)([\s\S]*?)(\n      \])/g,
  (_, start, rows, end) => start + rows.replace(/\[\n\s+([\d.-]+),\n\s+([\d.-]+),\n\s+(\d+)\n\s+\]/g, '[$1, $2, $3]') + end);
writeFileSync(contentUrl, serialized + '\n');
console.log(`${withRecords.length}종 · 지도 좌표 ${records.filter((row) => 'lat' in row).length}건 · 구역 자료 ${records.filter((row) => 'area' in row).length}건`);
console.table(Object.fromEntries(Object.entries(Object.groupBy(records, (row) => row.source)).map(([source, rows]) => [source, rows.length])));
