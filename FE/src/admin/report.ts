import { ID_STATUS_LABEL, toKst } from '@shared/dwc';
import type { AdminRow, AdminWalk } from '../backend/types';
import { CATEGORY_LABEL, type Taxon } from '../content/types';
import { kstDate } from '../lib/time';
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

/**
 * 관찰기록 전체표의 한 행(화면 표와 엑셀이 같이 씁니다). 사진 경로·가족 id는 들어 있지 않습니다.
 * 기록 ID는 관찰 UUID 앞 8자리입니다. shortcut: 겹칠 수 있는 확률은 아주 낮지만 보장하진 않음, 겹치면 전체 UUID를 쓰세요.
 */
export const shortId = (id: string) => id.slice(0, 8);

export function recordRow(r: AdminRow, participant: number, taxon: Taxon | undefined, walkNo?: number) {
  const st = statusOf(r);
  const mark = (v: string) => (st?.verified ? v : `${v} (검증 전)`);
  return {
    id: shortId(r.id),
    date: kstDateTime(r.observed_at).slice(0, 10),
    observedAt: kstDateTime(r.observed_at),
    participant: `참여자 ${participant}`,
    walkNo: walkNo ? `산책 ${walkNo}` : '',
    name: r.vernacular_name ?? (r.free_text_name ? `${r.free_text_name} (직접 입력)` : '이름 모름'),
    scientificName: r.scientific_name ?? '',
    group: taxon ? CATEGORY_LABEL[taxon.category] : '',
    pickSource: PICK_SOURCE_LABEL[r.pick_source] ?? r.pick_source,
    lat: r.subject_lat,
    lng: r.subject_lng,
    radius: r.radius_m,
    method: LOCATION_METHOD_LABEL[r.location_method] ?? r.location_method,
    hasObserver: r.observer_lat != null && r.observer_lng != null ? '있음' : '없음',
    zone: r.zone_name ?? r.zone_id ?? (r.outside_park ? '공원 밖' : ''),
    zoneCode: r.zone_id ?? '',
    zoneName: r.zone_name ?? (r.outside_park ? '공원 밖' : ''),
    biotope: r.biotope_name ?? '',
    biotopeCode: r.biotope_code ?? '',
    photos: r.photo_paths.length,
    alien: st?.alien ? mark('예') : '',
    protection: st?.protection ? mark(st.protection) : '',
    review: ID_STATUS_LABEL[r.id_status],
  };
}

/** 산책 번호: 전체 산책을 시작 시각 순서로 센 번호(기간 필터와 상관없이 같은 산책은 같은 번호) */
export function walkNumbers(walks: AdminWalk[]): Map<string, number> {
  return new Map([...walks].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map((w, i) => [w.id, i + 1]));
}

/** 기록이 있는 산책의 횟수와 총 시간(분). 아직 안 끝난 산책은 마지막 활동 시각까지로 셉니다. */
export function walkSummary(rows: AdminRow[], walks: AdminWalk[]) {
  const ids = new Set(rows.map((r) => r.walk_id));
  const used = walks.filter((w) => ids.has(w.id));
  const minutes = used.reduce((sum, w) => sum + Math.max(0, Date.parse(w.endedAt ?? w.lastActivityAt) - Date.parse(w.startedAt)) / 60000, 0);
  return { count: used.length, minutes: Math.round(minutes) };
}

/** 관찰일(한국 시간)이 기간(from~to, 양끝 포함, 비우면 제한 없음) 안인지 */
export function inPeriod(r: AdminRow, from: string, to: string): boolean {
  const day = kstDate(r.observed_at);
  return (!from || day >= from) && (!to || day <= to);
}

export const RADIUS_BINS = ['10m 이하', '10~25m', '25~50m', '50m 초과', '값 없음'] as const;
export function radiusBin(m: number | null | undefined): (typeof RADIUS_BINS)[number] {
  if (m == null) return '값 없음';
  return m <= 10 ? '10m 이하' : m <= 25 ? '10~25m' : m <= 50 ? '25~50m' : '50m 초과';
}

/** 라벨별 건수. order에 있는 라벨은 0건이어도 먼저, 그 밖의 값은 뒤에 붙입니다. */
export function countBy(rows: AdminRow[], key: (r: AdminRow) => string, order: readonly string[]): [string, number][] {
  const n = new Map<string, number>(order.map((k) => [k, 0]));
  for (const r of rows) n.set(key(r), (n.get(key(r)) ?? 0) + 1);
  return [...n];
}

export interface BiotopeSummary {
  code: string;
  name: string;
  records: number;
  species: number;
  speciesList: string;
  important: number;
}

/** 비오톱별 요약. 비오톱이 없는 기록은 코드 공란("비오톱 없음")으로 묶습니다. */
export function biotopeSummary(rows: AdminRow[]): BiotopeSummary[] {
  const groups = new Map<string, AdminRow[]>();
  for (const r of rows) groups.set(r.biotope_code ?? '', [...(groups.get(r.biotope_code ?? '') ?? []), r]);
  return [...groups]
    .map(([code, rs]) => {
      const taxa = new Map(rs.filter((r) => r.taxon_id).map((r) => [r.taxon_id!, r]));
      return {
        code,
        name: rs.find((r) => r.biotope_name)?.biotope_name ?? (code ? '' : '비오톱 없음'),
        records: rs.length,
        species: taxa.size,
        speciesList: [...taxa.values()].map((r) => r.vernacular_name ?? r.taxon_id!).sort((a, b) => a.localeCompare(b, 'ko')).join(', '),
        important: [...taxa.values()].filter((r) => isAlien(r) || isProtected(r)).length,
      };
    })
    .sort((a, b) => b.records - a.records);
}
