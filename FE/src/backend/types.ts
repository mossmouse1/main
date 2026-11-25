import type { ExportRow, HistoryRow, IdStatus } from '@shared/dwc';
import type { IdentifyResult } from '@shared/identify';
import type { MediaSource, MyStatus, ObservationPayload, UsageEvent, WalkPayload } from '../data/types';

export type { IdentifyResult } from '@shared/identify';

/** 가족 앱이 서버에 하는 일(PRD 8장 서버 인터페이스) */
export interface FamilyBackend {
  mode: 'local' | 'supabase';
  /** 기기 익명 계정. 없으면 만듭니다. 서버 계정 id를 돌려줍니다. */
  ensureAuth(): Promise<string>;
  registerConsent(input: { version: string; consentedAt: string; adults: number | null; children: number | null }): Promise<void>;
  startWalk(walk: WalkPayload): Promise<void>;
  endWalk(walk: WalkPayload): Promise<void>;
  /** occurrenceID 기준 멱등 저장 */
  upsertObservation(obs: ObservationPayload): Promise<void>;
  uploadPhoto(photo: {
    photoId: string;
    observationId: string;
    original: Blob | null;
    display: Blob | null;
    mime: string;
    exifTime: string | null;
    mediaSource: MediaSource;
  }): Promise<void>;
  fetchMyStatuses(): Promise<MyStatus[]>;
  sendEvents(events: UsageEvent[]): Promise<void>;
  requestDeletion(reason: string): Promise<void>;
  /** 기록 지키기(F14): 이메일 매직 링크로 익명 계정 연결 */
  linkEmail(email: string): Promise<void>;
  linkedEmail(): Promise<string | null>;
  /** 사진으로 종 후보 추천(서버 AI). 로컬 모드에서는 쓸 수 없습니다. */
  identifySpecies(image: Blob): Promise<IdentifyResult>;
  fetchCommunityMap(): Promise<CommunityCell[]>;
  watchCommunityMap(onChange: () => void): () => void;
}

export interface CommunityCell {
  taxon_id: string;
  cell_x: number;
  cell_y: number;
  lat: number;
  lng: number;
  family_count: number;
}

/** identifySpecies 실패 이유(화면에서 한국어로 바꿉니다) */
export type IdentifyErrorCode = 'rate_limited' | 'daily_limit' | 'global_limit' | 'consent_required' | 'too_large' | 'invalid_image' | 'unavailable' | 'network' | 'failed';
export class IdentifyError extends Error {
  constructor(public code: IdentifyErrorCode) {
    super(code);
  }
}

/** 검토 화면에서 쓰는 행: 내보내기 행 + 검토에 필요한 값 */
export interface AdminRow extends ExportRow {
  taxon_id: string | null;
  family_taxon_id: string | null;
  candidate_ids: string[];
  pick_source: string;
  created_at: string;
  client_created_at: string;
  found_at: string | null;
  hidden_reason: string | null;
}

export interface AdminPhoto {
  id: string;
  url: string | null;
  hidden: boolean;
  mediaSource: MediaSource;
  exifTime: string | null;
}

export interface AdminFilters {
  from?: string;
  to?: string;
  statuses?: IdStatus[];
  includeHidden?: boolean;
}

export interface ReviewChanges {
  taxonId?: string | null;
  status?: IdStatus;
  reason?: string;
  hidden?: boolean;
  hiddenReason?: string;
  establishmentMeans?: string | null;
}

export interface DeletionRequest {
  id: number;
  householdNo: number;
  requestedAt: string;
  reason: string;
  status: string;
}

export interface AdminBackend {
  mode: 'local' | 'supabase';
  currentUser(): Promise<{ email: string } | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  listObservations(filters: AdminFilters): Promise<AdminRow[]>;
  listPhotos(observationId: string): Promise<AdminPhoto[]>;
  setPhotoHidden(photoId: string, hidden: boolean): Promise<void>;
  history(observationId: string): Promise<HistoryRow[]>;
  review(observationId: string, changes: ReviewChanges): Promise<void>;
  duplicateCandidates(observationId: string): Promise<AdminRow[]>;
  /** 같은 개체로 묶습니다. 묶음 id를 돌려줍니다. */
  groupDuplicates(observationIds: string[]): Promise<string>;
  ungroup(observationId: string): Promise<void>;
  exportCsv(kind: 'observations' | 'history', filters: AdminFilters): Promise<Blob>;
  listDeletionRequests(): Promise<DeletionRequest[]>;
}
