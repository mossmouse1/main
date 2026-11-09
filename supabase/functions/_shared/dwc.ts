/**
 * Darwin Core 내보내기 매핑. 웹(로컬 모드·테스트)과 Edge Function이 같이 씁니다.
 * 외부 import 없이 순수 TS로 둡니다(Deno와 Vite 양쪽에서 읽힘).
 */

export type IdStatus = 'unidentified' | 'family' | 'reviewed' | 'undeterminable';

export const ID_STATUS_LABEL: Record<IdStatus, string> = {
  unidentified: '미동정',
  family: '추정(가족)',
  reviewed: '검토 완료',
  undeterminable: '판단 불가',
};

export const DATASET = {
  datasetName: '우리 공원 생명 도감 시범',
  countryCode: 'KR',
  stateProvince: '경기도',
  municipality: '화성시',
  park: '동탄호수공원',
  samplingProtocol: '자유 관찰(가족 산책)',
  basisOfRecord: 'HumanObservation',
  geodeticDatum: 'WGS84',
} as const;

/** 자료 이용 조건은 아직 정하지 않았습니다(PRD 12장). 정해지면 여기에 넣습니다. */
export const DATA_LICENSE = '';
export const REVIEWER_LABEL = '이끼마우스 검토자';

/** 서버 뷰 observation_details와 로컬 가짜 서버가 같은 모양으로 돌려주는 행 */
export interface ExportRow {
  id: string;
  walk_id: string;
  observed_at: string;
  household_no: number;
  vernacular_name: string | null;
  scientific_name: string | null;
  family_vernacular_name: string | null;
  free_text_name: string | null;
  id_status: IdStatus;
  subject_lat: number;
  subject_lng: number;
  radius_m: number;
  location_method: 'tap' | 'near_me';
  distance_m: number | null;
  observer_lat: number | null;
  observer_lng: number | null;
  observer_accuracy_m: number | null;
  zone_id: string | null;
  zone_name: string | null;
  outside_park: boolean;
  biotope_code: string | null;
  biotope_name: string | null;
  biotope_year: number | null;
  biotope_source: string | null;
  effort_text: string | null;
  establishment_means: string | null;
  date_identified: string | null;
  identification_remarks: string | null;
  duplicate_group_id: string | null;
  /** 숨기지 않은 사진의 저장소 경로 */
  photo_paths: string[];
  hidden: boolean;
}

export const DWC_COLUMNS = [
  'occurrenceID',
  'eventID',
  'basisOfRecord',
  'eventDate',
  'eventTime',
  'recordedBy',
  'vernacularName',
  'scientificName',
  'identificationVerificationStatus',
  'identifiedBy',
  'dateIdentified',
  'identificationRemarks',
  'decimalLatitude',
  'decimalLongitude',
  'geodeticDatum',
  'coordinateUncertaintyInMeters',
  'georeferenceRemarks',
  'locality',
  'habitat',
  'samplingProtocol',
  'samplingEffort',
  'establishmentMeans',
  'associatedMedia',
  'license',
  'datasetName',
  'countryCode',
  'stateProvince',
  'municipality',
  // 확장 열
  'observerLatitude',
  'observerLongitude',
  'observerAccuracyM',
  'duplicateGroupId',
] as const;

export type DwcColumn = (typeof DWC_COLUMNS)[number];

export const householdLabel = (no: number) => `가족-${String(no).padStart(4, '0')}`;

/** 한국 시간(UTC+9, 서머타임 없음)으로 날짜와 시각 */
export function toKst(iso: string): { date: string; time: string } {
  const s = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return { date: s.slice(0, 10), time: `${s.slice(11, 16)}+09:00` };
}

const num = (n: number | null | undefined, digits?: number) =>
  n == null ? '' : digits == null ? String(n) : n.toFixed(digits);

export function georeferenceRemarks(r: ExportRow): string {
  if (r.location_method === 'near_me') {
    return `내 근처(촬영자 위치 사용), GPS 정확도 ${num(r.observer_accuracy_m) || '모름'}m`;
  }
  return r.distance_m == null ? '지도 탭, 촬영자 위치 없음' : `지도 탭, 촬영자로부터 ${Math.round(r.distance_m)}m`;
}

export function locality(r: ExportRow): string {
  if (r.outside_park) return `${DATASET.park} 밖`;
  return r.zone_id ? `${DATASET.park} ${r.zone_id} ${r.zone_name ?? ''}`.trim() : `${DATASET.park} (조사구역 밖)`;
}

export function habitat(r: ExportRow): string {
  if (!r.biotope_code) return '';
  return `${r.biotope_code} ${r.biotope_name ?? ''}(${r.biotope_source ?? ''} ${r.biotope_year ?? ''})`.replace(/\s+\)/, ')');
}

export function observationToDwc(r: ExportRow): Record<DwcColumn, string> {
  const when = toKst(r.observed_at);
  const reviewed = r.id_status === 'reviewed' || r.id_status === 'undeterminable';
  // 판단 불가는 이름을 비우고, 가족이 고른 이름은 비고로 남깁니다.
  const showName = r.id_status === 'reviewed' || r.id_status === 'family';
  const remarks = [
    r.identification_remarks,
    // ‘목록에 없어요’에서 적은 이름, 또는 ‘아직 모르겠어요’ 화면의 관찰 메모
    r.free_text_name ? `가족이 적은 이름·메모: ${r.free_text_name}` : null,
    r.id_status === 'undeterminable' && r.family_vernacular_name ? `가족 선택: ${r.family_vernacular_name}` : null,
  ].filter(Boolean);

  return {
    occurrenceID: r.id,
    eventID: r.walk_id,
    basisOfRecord: DATASET.basisOfRecord,
    eventDate: when.date,
    eventTime: when.time,
    recordedBy: householdLabel(r.household_no),
    vernacularName: showName ? (r.vernacular_name ?? '') : '',
    scientificName: showName ? (r.scientific_name ?? '') : '',
    identificationVerificationStatus: ID_STATUS_LABEL[r.id_status],
    identifiedBy: reviewed ? REVIEWER_LABEL : r.id_status === 'family' ? householdLabel(r.household_no) : '',
    dateIdentified: reviewed ? (r.date_identified ? toKst(r.date_identified).date : '') : r.id_status === 'family' ? when.date : '',
    identificationRemarks: remarks.join(' / '),
    decimalLatitude: num(r.subject_lat, 6),
    decimalLongitude: num(r.subject_lng, 6),
    geodeticDatum: DATASET.geodeticDatum,
    coordinateUncertaintyInMeters: num(r.radius_m),
    georeferenceRemarks: georeferenceRemarks(r),
    locality: locality(r),
    habitat: habitat(r),
    samplingProtocol: DATASET.samplingProtocol,
    samplingEffort: r.effort_text ?? '',
    establishmentMeans: r.establishment_means ?? '',
    associatedMedia: r.photo_paths.join(' | '),
    license: DATA_LICENSE,
    datasetName: DATASET.datasetName,
    countryCode: DATASET.countryCode,
    stateProvince: DATASET.stateProvince,
    municipality: DATASET.municipality,
    observerLatitude: num(r.observer_lat, 6),
    observerLongitude: num(r.observer_lng, 6),
    observerAccuracyM: num(r.observer_accuracy_m),
    duplicateGroupId: r.duplicate_group_id ?? '',
  };
}

export interface HistoryRow {
  observation_id: string;
  created_at: string;
  actor: 'household' | 'reviewer';
  vernacular_name: string | null;
  scientific_name: string | null;
  status: IdStatus;
  previous_vernacular_name: string | null;
  previous_status: IdStatus | null;
  reason: string | null;
}

export const HISTORY_COLUMNS = [
  'occurrenceID',
  'changedAt',
  'actor',
  'previousVernacularName',
  'previousStatus',
  'vernacularName',
  'scientificName',
  'identificationVerificationStatus',
  'reason',
] as const;

export function historyToRow(h: HistoryRow): Record<(typeof HISTORY_COLUMNS)[number], string> {
  const t = toKst(h.created_at);
  return {
    occurrenceID: h.observation_id,
    changedAt: `${t.date} ${t.time}`,
    actor: h.actor === 'reviewer' ? REVIEWER_LABEL : '가족',
    previousVernacularName: h.previous_vernacular_name ?? '',
    previousStatus: h.previous_status ? ID_STATUS_LABEL[h.previous_status] : '',
    vernacularName: h.vernacular_name ?? '',
    scientificName: h.scientific_name ?? '',
    identificationVerificationStatus: ID_STATUS_LABEL[h.status],
    reason: h.reason ?? '',
  };
}

function cell(value: string): string {
  // 엑셀이 수식으로 읽지 않게 막습니다.
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** UTF-8 BOM + CRLF(엑셀 한글 대응) */
export function toCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? '')).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
