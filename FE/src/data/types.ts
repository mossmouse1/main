import type { IdStatus } from '@shared/dwc';
import type { LatLng } from '../lib/geo';

export { ID_STATUS_LABEL, type IdStatus } from '@shared/dwc';

export type MediaSource = 'camera' | 'album';
/** 후보를 어디서 골랐는지: 생물 카드 / 현재 구역 / 이름 검색 / 직접 입력 / 잘 모르겠어요 */
export type PickSource = 'card' | 'zone' | 'search' | 'free_text' | 'unknown' | 'photo_ai';
export type LocationMethod = 'tap' | 'near_me';

export interface ObserverFix extends LatLng {
  accuracy: number;
  at: string;
}

export interface Household {
  id: string;
  consentVersion: string | null;
  consentedAt: string | null;
  adults: number | null;
  children: number | null;
}

export interface LocalWalk {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: 'manual' | 'auto' | null;
  lastActivityAt: string;
  adults: number | null;
  children: number | null;
  zoneIds: string[];
  effortText: string | null;
  summarySeen: boolean;
}

export interface LocalObservation {
  id: string;
  walkId: string;
  createdAt: string;
  observedAt: string;
  observedAtSource: 'exif' | 'device';
  /** 가족이 고른 종(바뀌지 않음) */
  familyTaxonId: string | null;
  /** 지금 종(검토에서 바뀔 수 있음) */
  taxonId: string | null;
  freeTextName: string | null;
  pickSource: PickSource;
  candidateIds: string[];
  idStatus: IdStatus;
  observer: ObserverFix | null;
  subject: LatLng;
  radiusM: number;
  locationMethod: LocationMethod;
  distanceM: number | null;
  zoneId: string | null;
  biotopeCode: string | null;
  outsidePark: boolean;
  photoIds: string[];
  sync: 'pending' | 'sent';
  hidden: boolean;
  /** 검토에서 종이 바뀌었는지, 가족이 그 표시를 봤는지 */
  reviewChanged: boolean;
  reviewSeen: boolean;
  /** ‘찾았어요’를 누른 시각과 저장 시각(기록 시간 지표) */
  foundAt: string;
}

export interface LocalPhoto {
  id: string;
  observationId: string;
  /** 서버가 받은 것을 확인하면 지웁니다. */
  original: Blob | null;
  display: Blob | null;
  mime: string;
  exifTime: string | null;
  mediaSource: MediaSource;
  uploaded: boolean;
}

export interface DraftPhoto {
  id: string;
  original: Blob;
  display: Blob | null;
  mime: string;
  exifTime: string | null;
  mediaSource: MediaSource;
  /** 사진을 받은 시각(EXIF가 없을 때 관찰 시각) */
  capturedAt: string;
}

/** 기록하기 중간 상태. 카메라를 여는 동안 웹뷰가 다시 로드돼도 이어지도록 기기에 둡니다. */
export interface RecordDraft {
  id: 'current';
  draftId: string;
  foundAt: string;
  sourceTaxonId: string | null;
  photos: DraftPhoto[];
  observer: ObserverFix | null;
  candidateIds: string[];
  taxonId: string | null;
  freeTextName: string | null;
  pickSource: PickSource | null;
  /** ‘있던 곳’에서 고른 생물 위치(사진 다음 단계). 이름 확인 화면에서 바꿀 수 있습니다. */
  subject?: LatLng | null;
  radiusM?: number;
  locationMethod?: LocationMethod;
}

export type OutboxKind = 'walk' | 'observation' | 'photo' | 'events' | 'deletion';

export interface OutboxItem {
  id?: number;
  kind: OutboxKind;
  refId: string;
  /** 사진·기록이 어느 관찰에 속하는지(전송됨 판정용) */
  obsId?: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface UsageEvent {
  id?: number;
  name: string;
  at: string;
  props: Record<string, string | number | boolean | null>;
}

export interface ObservationPayload {
  id: string;
  walk: { id: string; startedAt: string; adults: number | null; children: number | null };
  observedAt: string;
  observedAtSource: 'exif' | 'device';
  clientCreatedAt: string;
  foundAt: string;
  familyTaxonId: string | null;
  freeTextName: string | null;
  pickSource: PickSource;
  candidateIds: string[];
  idStatus: 'unidentified' | 'family';
  subjectLat: number;
  subjectLng: number;
  radiusM: number;
  locationMethod: LocationMethod;
  distanceM: number | null;
  observerLat: number | null;
  observerLng: number | null;
  observerAccuracyM: number | null;
}

export interface WalkPayload {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: 'manual' | 'auto' | null;
  adults: number | null;
  children: number | null;
}

/** 서버에 있는 우리 기록. 검토 결과를 받고, 기기 저장소가 비었을 때 도감을 되살리는 데 씁니다. */
export interface MyStatus {
  id: string;
  walkId: string;
  observedAt: string;
  familyTaxonId: string | null;
  taxonId: string | null;
  freeTextName: string | null;
  idStatus: IdStatus;
  hidden: boolean;
  zoneId: string | null;
  subjectLat: number;
  subjectLng: number;
  radiusM: number;
}
