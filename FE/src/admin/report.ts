import { ID_STATUS_LABEL, toKst } from '@shared/dwc';
import type { AdminRow } from '../backend/types';
import { CATEGORY_LABEL, type Taxon } from '../content/types';
import status from './taxon-status.json';

/** 종 상태. 값이 있는 종만 적혀 있고 전부 검증 전입니다(공란 = 확인 안 됨). */
export interface TaxonStatus {
  alien?: boolean;
  protection?: string;
  source?: string;
  verified: boolean;
}
export const TAXON_STATUS = status as unknown as Record<string, TaxonStatus>;

export const PICK_SOURCE_LABEL: Record<string, string> = {
  card: '찾으러 온 생물(카드)',
  zone: '구역 추천',
  search: '이름 검색',
  photo_ai: '사진 추천(AI)',
  free_text: '목록에 없어요(직접 입력)',
  unknown: '잘 모르겠어요',
};

export const LOCATION_METHOD_LABEL = { tap: '지도에서 직접 찍음', near_me: '내 근처' } as const;

export const kstDateTime = (iso: string) => {
  const k = toKst(iso);
  return `${k.date} ${k.time.slice(0, 5)}`;
};

/** 도감 밖 기록: "목록에 없어요" · "잘 모르겠어요" */
export const isOutOfDex = (r: AdminRow) => r.pick_source === 'free_text' || r.pick_source === 'unknown';

const statusOf = (r: AdminRow): TaxonStatus | undefined => (r.taxon_id ? TAXON_STATUS[r.taxon_id] : undefined);
export const isAlien = (r: AdminRow) => statusOf(r)?.alien === true;
export const isProtected = (r: AdminRow) => !!statusOf(r)?.protection;
/** 값이 채워져 있는데 아직 검증 전인 종 */
export const isUnverified = (r: AdminRow) => {
  const s = statusOf(r);
  return !!s && (s.alien || !!s.protection) && !s.verified;
};

/** 가족을 첫 기록 시각 순서대로 1, 2, 3… (household_no → 참여자 번호). 개인 식별을 피하려고 원래 번호는 내보내지 않습니다. */
export function participantNumbers(rows: AdminRow[]): Map<number, number> {
  const first = new Map<number, number>();
  for (const r of rows) {
    const t = Date.parse(r.observed_at);
    if (!first.has(r.household_no) || t < first.get(r.household_no)!) first.set(r.household_no, t);
  }
  return new Map([...first].sort((a, b) => a[1] - b[1]).map(([no], i) => [no, i + 1]));
}

export function summarize(rows: AdminRow[]) {
  const withPhoto = rows.filter((r) => r.photo_paths.length > 0).length;
  return {
    records: rows.length,
    households: new Set(rows.map((r) => r.household_no)).size,
    species: new Set(rows.flatMap((r) => (r.taxon_id ? [r.taxon_id] : []))).size,
    photoRate: rows.length ? withPhoto / rows.length : 0,
  };
}

export interface Appearance {
  taxonId: string;
  name: string;
  scientificName: string;
  count: number;
  first: string;
  last: string;
  places: string;
  protection: string;
  verified: boolean;
}

/** 종별 출현 요약(기록 수, 처음·마지막 관찰일, 구역/비오톱). 기록 수 많은 순. */
export function appearances(rows: AdminRow[], pick: (r: AdminRow) => boolean): Appearance[] {
  const byTaxon = new Map<string, AdminRow[]>();
  for (const r of rows) if (r.taxon_id && pick(r)) byTaxon.set(r.taxon_id, [...(byTaxon.get(r.taxon_id) ?? []), r]);
  return [...byTaxon]
    .map(([taxonId, rs]) => {
      const times = rs.map((r) => Date.parse(r.observed_at));
      const places = [...new Set(rs.map((r) => [r.zone_name ?? r.zone_id ?? (r.outside_park ? '공원 밖' : ''), r.biotope_name ?? ''].filter(Boolean).join(' / ')).filter(Boolean))];
      const st = TAXON_STATUS[taxonId];
      return {
        taxonId,
        name: rs[0].vernacular_name ?? taxonId,
        scientificName: rs[0].scientific_name ?? '',
        count: rs.length,
        first: kstDateTime(new Date(Math.min(...times)).toISOString()).slice(0, 10),
        last: kstDateTime(new Date(Math.max(...times)).toISOString()).slice(0, 10),
        places: places.join(', '),
        protection: st?.protection ?? '',
        verified: st?.verified ?? false,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** 관찰기록 전체표의 한 행(화면 표와 엑셀이 같이 씁니다). 사진 경로·가족 id는 들어 있지 않습니다. */
export function recordRow(r: AdminRow, participant: number, taxon: Taxon | undefined) {
  const st = statusOf(r);
  const mark = (v: string) => (st?.verified ? v : `${v} (검증 전)`);
  return {
    observedAt: kstDateTime(r.observed_at),
    participant: `참여자 ${participant}`,
    name: r.vernacular_name ?? (r.free_text_name ? `${r.free_text_name} (직접 입력)` : '이름 모름'),
    scientificName: r.scientific_name ?? '',
    group: taxon ? CATEGORY_LABEL[taxon.category] : '',
    pickSource: PICK_SOURCE_LABEL[r.pick_source] ?? r.pick_source,
    lat: r.subject_lat,
    lng: r.subject_lng,
    method: LOCATION_METHOD_LABEL[r.location_method] ?? r.location_method,
    zone: r.zone_name ?? r.zone_id ?? (r.outside_park ? '공원 밖' : ''),
    biotope: r.biotope_name ?? '',
    photos: r.photo_paths.length,
    alien: st?.alien ? mark('예') : '',
    protection: st?.protection ? mark(st.protection) : '',
    review: ID_STATUS_LABEL[r.id_status],
  };
}
