import { seasonContains, taxonById } from '../content/helpers';
import type { Content, SeasonSet, Taxon } from '../content/types';

export interface DexObservation {
  id: string;
  taxonId: string | null;
  observedAt: string;
  hidden: boolean;
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
  /** 아직 못 찾은 종 하나(오늘 6종 먼저) */
  nextClue: Taxon | null;
  foundIds: Set<string>;
  /** 검토에서 종이 바뀌었는데 가족이 아직 못 본 기록 수(칸이 비게 된 경우 포함) */
  changedUnseen: number;
}

/**
 * 칸은 이번 계절 세트로 만들고, 그 종으로 고른 기록이 계절 안에 한 건이라도 있으면 채웁니다.
 * 검토에서 종이 바뀌면 taxonId가 바뀌므로 자연히 다시 계산됩니다. 팀이 숨긴 기록은 세지 않습니다.
 */
export function computeDex(content: Content, season: SeasonSet, observations: DexObservation[], seen: string[]): DexState {
  const valid = observations.filter((o) => o.taxonId && !o.hidden && seasonContains(season, o.observedAt));
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
  const nextId = [...season.todaySix, ...season.dex].find((id) => !foundIds.has(id));
  return {
    cells,
    filled: cells.filter((c) => c.filled).length,
    total: cells.length,
    nextClue: taxonById(content, nextId) ?? null,
    foundIds,
    changedUnseen: observations.filter((o) => !o.hidden && o.reviewChanged && !o.reviewSeen).length,
  };
}
