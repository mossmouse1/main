import { seasonContains, taxonById } from '../content/helpers';
import type { Content, SeasonSet, Taxon } from '../content/types';

export interface DexObservation {
  id: string;
  taxonId: string | null;
  freeTextName?: string | null;
  observedAt: string;
  hidden: boolean;
  outsidePark: boolean;
  zoneId: string | null;
  photoIds: string[];
  reviewChanged: boolean;
  reviewSeen: boolean;
}

export interface DexCell {
  taxon: Taxon;
  filled: boolean;
  /** 새로 채웠고 가족이 아직 도감에서 못 본 칸 */
  isNew: boolean;
  /** 검토에서 종이 바뀌어 채워진 칸 */
  changedByReview: boolean;
}

export interface DexState {
  cells: DexCell[];
  filled: number;
  total: number;
  foundIds: Set<string>;
  /** 검토에서 종이 바뀌었는데 가족이 아직 못 본 기록 수(칸이 비게 된 경우 포함) */
  changedUnseen: number;
  completion: DexCompletion | null;
  collectionFoundIds: Set<string>;
  unnamed: { id: string; name: string | null; observedAt: string }[];
}

export interface DexCompletion {
  completedAt: string;
  entries: { taxon: Taxon; photoIds: string[] }[];
}

export type QuestReward = 'discovery' | 'completion';

export function questMapUrl(): string {
  return '/?public=0';
}

export function isQuestObservation(content: Content, season: SeasonSet, observation: DexObservation): boolean {
  return !!observation.taxonId && !observation.hidden && !!observation.photoIds?.length &&
    !observation.outsidePark && observation.zoneId !== 'Z6' &&
    content.zones.some((zone) => zone.id === observation.zoneId) && seasonContains(season, observation.observedAt);
}

/**
 * 공원 조사구역에서 해당 계절에 사진을 남긴 종으로 칸을 채웁니다.
 * 검토에서 종이 바뀌면 taxonId가 바뀌므로 자연히 다시 계산됩니다. 팀이 숨긴 기록은 세지 않습니다.
 */
export function computeDex(content: Content, season: SeasonSet, observations: DexObservation[], seen: string[]): DexState {
  const photographed = observations.filter((o) => !o.hidden && o.photoIds?.length);
  const valid = photographed.filter((o) => isQuestObservation(content, season, o));
  const foundIds = new Set(valid.map((o) => o.taxonId!));
  const seenSet = new Set(seen);
  const cells = season.dex
    .map((id) => taxonById(content, id))
    .filter((t): t is Taxon => !!t)
    .map((taxon) => ({
      taxon,
      filled: foundIds.has(taxon.id),
      isNew: foundIds.has(taxon.id) && !seenSet.has(taxon.id),
      changedByReview: valid.some((o) => o.taxonId === taxon.id && o.reviewChanged && !o.reviewSeen),
    }));
  const filled = cells.filter((c) => c.filled).length;
  let completion: DexCompletion | null = null;
  if (filled === 10 && filled === season.dex.length && filled === cells.length) {
    const byTaxon = new Map<string, DexObservation[]>();
    for (const observation of [...valid].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
      const id = observation.taxonId!;
      const records = byTaxon.get(id) ?? [];
      records.push(observation);
      byTaxon.set(id, records);
    }
    const records = cells.map(({ taxon }) => ({ taxon, observations: byTaxon.get(taxon.id)! }));
    completion = {
      completedAt: records.map(({ observations }) => observations[0].observedAt).sort().at(-1)!,
      entries: records.map(({ taxon, observations }) => ({ taxon, photoIds: observations.flatMap((o) => o.photoIds) })),
    };
  }
  return {
    cells,
    filled,
    total: cells.length,
    foundIds,
    changedUnseen: observations.filter((o) => !o.hidden && o.reviewChanged && !o.reviewSeen).length,
    completion,
    collectionFoundIds: new Set(photographed.flatMap((o) => taxonById(content, o.taxonId) ? [o.taxonId!] : [])),
    unnamed: photographed.filter((o) => !taxonById(content, o.taxonId))
      .map((o) => ({ id: o.id, name: o.freeTextName ?? null, observedAt: o.observedAt }))
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
  };
}
