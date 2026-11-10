import type { Content, SeasonSet, Taxon, Zone } from './types';

const taxonIndex = new WeakMap<Content, Map<string, Taxon>>();

export function taxonById(content: Content, id: string | null | undefined): Taxon | undefined {
  if (!id) return undefined;
  let index = taxonIndex.get(content);
  if (!index) {
    index = new Map(content.taxa.map((t) => [t.id, t]));
    taxonIndex.set(content, index);
  }
  return index.get(id);
}

export function zoneById(content: Content, id: string | null | undefined): Zone | undefined {
  return id ? content.zones.find((z) => z.id === id) : undefined;
}

/** 오늘 날짜가 들어가는 세트. 없으면 가장 가까운 세트 */
export function activeSeason(content: Content, date = new Date()): SeasonSet {
  const day = new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const hit = content.seasonSets.find((s) => s.startsOn <= day && day <= s.endsOn);
  if (hit) return hit;
  const dist = (s: SeasonSet) => Math.min(Math.abs(Date.parse(s.startsOn) - date.getTime()), Math.abs(Date.parse(s.endsOn) - date.getTime()));
  return [...content.seasonSets].sort((a, b) => dist(a) - dist(b))[0];
}

export function seasonContains(season: SeasonSet, iso: string): boolean {
  const day = new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
  return season.startsOn <= day && day <= season.endsOn;
}

/** 같은 기록 안에서는 순서가 바뀌지 않게, 기록 id로 섞습니다. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    const j = (h >>> 0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 생물 카드에서 시작: 그 종 + 헷갈리는 종 2개 */
export function candidatesFromTaxon(content: Content, taxonId: string, seed: string): string[] {
  const taxon = taxonById(content, taxonId);
  if (!taxon) return [];
  const ids = [taxon.id, ...taxon.confusableIds.filter((id) => taxonById(content, id)).slice(0, 2)];
  return seededShuffle(ids, seed);
}

/** 기록하기 탭에서 시작: 현재 구역 후보(오늘 6종 먼저), 모자라면 오늘 6종으로 채움 */
export function candidatesFromZone(content: Content, zoneId: string | null, season: SeasonSet, seed: string): string[] {
  const inZone = (id: string) => !!zoneId && !!taxonById(content, id)?.clue.zoneIds.includes(zoneId);
  const pool = [
    ...season.todaySix.filter(inZone),
    ...season.dex.filter(inZone),
    ...content.taxa.filter((t) => !t.minor && inZone(t.id)).map((t) => t.id),
    ...season.todaySix,
  ];
  return seededShuffle([...new Set(pool)].slice(0, 3), seed);
}

/**
 * 이름 검색(‘목록에 없어요’, 지도 검색). 카드가 있는 종을 먼저, 그다음 공원 주변 공개 기록에 나온 종을 기록 많은 순으로.
 * M3 species_catalog.json(591개)을 받으면 목록이 더 늘어납니다.
 */
export function searchTaxa(content: Content, query: string): Taxon[] {
  const q = query.trim().replace(/\s+/g, '');
  if (!q) return [];
  const rank = (t: Taxon) => (t.catalog ? 2 : t.minor ? 1 : 0);
  return content.taxa
    .filter((t) => t.koreanName.replace(/\s+/g, '').includes(q) || t.scientificName.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || (b.recordCount ?? 0) - (a.recordCount ?? 0))
    .slice(0, 20);
}
