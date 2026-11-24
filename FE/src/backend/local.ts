/**
 * 로컬 모드: Supabase 없이 브라우저 안의 가짜 서버(별도 IndexedDB)에 저장합니다.
 * supabase/migrations의 DB 함수와 같은 규칙(멱등 저장, 구역·비오톱 판정, 조사 노력, 검토 이력)을 따라 합니다.
 * 오프라인(navigator.onLine === false)이면 실제 서버처럼 실패합니다.
 */
import Dexie, { type EntityTable } from 'dexie';
import {
  DWC_COLUMNS,
  HISTORY_COLUMNS,
  historyToRow,
  observationToDwc,
  toCsv,
  type HistoryRow,
  type IdStatus,
} from '@shared/dwc';
import { WALK_IDLE_MS, WALK_MAX_MS } from '../config';
import { taxonById, zoneById } from '../content/helpers';
import { loadContent } from '../content/load';
import type { Content } from '../content/types';
import type { MediaSource, PickSource, WalkPayload } from '../data/types';
import { effortText } from '../lib/effort';
import { distanceM, findBiotope, findZone, inBounds } from '../lib/geo';
import { kstDate, minutesBetween } from '../lib/time';
import { uuid } from '../lib/uuid';
import { IdentifyError, type AdminBackend, type AdminFilters, type AdminRow, type FamilyBackend } from './types';

interface SrvHousehold {
  id: string;
  no: number;
  createdAt: string;
  consentVersion: string | null;
  consentedAt: string | null;
  adults: number | null;
  children: number | null;
}

interface SrvWalk {
  id: string;
  householdId: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: 'manual' | 'auto' | null;
  lastActivityAt: string;
  adults: number | null;
  children: number | null;
  zoneIds: string[];
  effortText: string | null;
}

interface SrvObservation {
  id: string;
  householdId: string;
  walkId: string;
  observedAt: string;
  observedAtSource: string;
  createdAt: string;
  clientCreatedAt: string;
  foundAt: string | null;
  familyTaxonId: string | null;
  freeTextName: string | null;
  pickSource: PickSource;
  candidateIds: string[];
  taxonId: string | null;
  idStatus: IdStatus;
  subjectLat: number;
  subjectLng: number;
  radiusM: number;
  locationMethod: 'tap' | 'near_me';
  distanceM: number | null;
  observerLat: number | null;
  observerLng: number | null;
  observerAccuracyM: number | null;
  zoneId: string | null;
  biotopeCode: string | null;
  biotopeName: string | null;
  biotopeYear: number | null;
  biotopeSource: string | null;
  outsidePark: boolean;
  establishmentMeans: string | null;
  duplicateGroupId: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  dateIdentified: string | null;
  identificationRemarks: string | null;
}

interface SrvPhoto {
  id: string;
  observationId: string;
  householdId: string;
  original: Blob | null;
  display: Blob | null;
  originalPath: string;
  displayPath: string | null;
  mime: string;
  exifTime: string | null;
  mediaSource: MediaSource;
  hidden: boolean;
  createdAt: string;
}

interface SrvIdentification {
  id?: number;
  observationId: string;
  taxonId: string | null;
  status: IdStatus;
  actor: 'household' | 'reviewer';
  reason: string | null;
  previousTaxonId: string | null;
  previousStatus: IdStatus | null;
  createdAt: string;
}

interface SrvEvent {
  id?: number;
  householdId: string;
  name: string;
  at: string;
  props: unknown;
}

interface SrvDeletion {
  id?: number;
  householdId: string;
  requestedAt: string;
  reason: string;
  status: string;
}

const srv = new Dexie('parkdex-local-server') as Dexie & {
  households: EntityTable<SrvHousehold, 'id'>;
  walks: EntityTable<SrvWalk, 'id'>;
  observations: EntityTable<SrvObservation, 'id'>;
  photos: EntityTable<SrvPhoto, 'id'>;
  identifications: EntityTable<SrvIdentification, 'id'>;
  events: EntityTable<SrvEvent, 'id'>;
  deletions: EntityTable<SrvDeletion, 'id'>;
};

srv.version(1).stores({
  households: 'id, no',
  walks: 'id, householdId',
  observations: 'id, householdId, walkId, observedAt',
  photos: 'id, observationId',
  identifications: '++id, observationId',
  events: '++id',
  deletions: '++id',
});

const UID_KEY = 'parkdex-local-uid';
const RATE_LIMIT_PER_MINUTE = 20;

async function network(): Promise<void> {
  await new Promise((r) => setTimeout(r, 120));
  if (!navigator.onLine) throw new Error('오프라인이에요');
}

function currentUid(): string {
  const uid = localStorage.getItem(UID_KEY);
  if (!uid) throw new Error('익명 계정이 아직 없어요');
  return uid;
}

async function ensureHouseholdRow(uid: string): Promise<SrvHousehold> {
  const existing = await srv.households.get(uid);
  if (existing) return existing;
  const row: SrvHousehold = {
    id: uid,
    no: (await srv.households.count()) + 1,
    createdAt: new Date().toISOString(),
    consentVersion: null,
    consentedAt: null,
    adults: null,
    children: null,
  };
  await srv.households.put(row);
  return row;
}

/** 서버 쪽 탐험 마무리: 기록이 나온 구역과 조사 노력을 다시 계산 */
async function finalizeWalk(walk: SrvWalk): Promise<SrvWalk> {
  if (!walk.endedAt) return walk;
  const obs = await srv.observations.where('walkId').equals(walk.id).toArray();
  const zoneIds = [...new Set(obs.map((o) => o.zoneId).filter((z): z is string => !!z))].sort();
  const updated: SrvWalk = {
    ...walk,
    zoneIds,
    effortText: effortText({
      adults: walk.adults,
      children: walk.children,
      minutes: minutesBetween(walk.startedAt, walk.endedAt),
      zoneIds,
    }),
  };
  await srv.walks.put(updated);
  return updated;
}

/** pg_cron의 close_idle_walks()와 같은 일: 30분 무활동이면 자동 종료(최대 3시간) */
async function closeIdleWalks(): Promise<void> {
  const now = Date.now();
  const open = (await srv.walks.toArray()).filter((w) => !w.endedAt);
  for (const w of open) {
    const idle = now - Date.parse(w.lastActivityAt) > WALK_IDLE_MS;
    const tooLong = now - Date.parse(w.startedAt) > WALK_MAX_MS;
    if (!idle && !tooLong) continue;
    const cap = Date.parse(w.startedAt) + WALK_MAX_MS;
    const endedAt = new Date(Math.min(Date.parse(w.lastActivityAt), cap)).toISOString();
    await finalizeWalk({ ...w, endedAt, endedBy: 'auto' });
  }
}

async function upsertWalkRow(uid: string, w: WalkPayload): Promise<SrvWalk> {
  const existing = await srv.walks.get(w.id);
  if (existing && existing.householdId !== uid) throw new Error('다른 가족의 탐험이에요');
  const row: SrvWalk = existing ?? {
    id: w.id,
    householdId: uid,
    startedAt: w.startedAt,
    endedAt: null,
    endedBy: null,
    lastActivityAt: w.startedAt,
    adults: w.adults,
    children: w.children,
    zoneIds: [],
    effortText: null,
  };
  await srv.walks.put(row);
  return row;
}

export const localFamily: FamilyBackend = {
  mode: 'local',

  async ensureAuth() {
    await network();
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = uuid();
      localStorage.setItem(UID_KEY, uid);
    }
    await ensureHouseholdRow(uid);
    return uid;
  },

  async registerConsent({ version, consentedAt, adults, children }) {
    await network();
    const h = await ensureHouseholdRow(currentUid());
    await srv.households.put({ ...h, consentVersion: version, consentedAt, adults, children });
  },

  async startWalk(w) {
    await network();
    await upsertWalkRow(currentUid(), w);
  },

  async endWalk(w) {
    await network();
    const row = await upsertWalkRow(currentUid(), w);
    if (!w.endedAt) return;
    await finalizeWalk({ ...row, endedAt: w.endedAt, endedBy: w.endedBy });
  },

  async upsertObservation(o) {
    await network();
    const uid = currentUid();
    const household = await srv.households.get(uid);
    if (!household?.consentedAt) throw new Error('동의 전에는 기록을 받을 수 없어요');
    if (await srv.observations.get(o.id)) return; // 같은 기록은 한 번만

    const since = Date.now() - 60_000;
    const recent = await srv.observations.where('householdId').equals(uid).filter((x) => Date.parse(x.createdAt) > since).count();
    if (recent >= RATE_LIMIT_PER_MINUTE) throw new Error('잠시 뒤에 다시 보내요(분당 20건 제한)');

    const content = await loadContent();
    const walk = await upsertWalkRow(uid, { ...o.walk, endedAt: null, endedBy: null });
    const subject = { lat: o.subjectLat, lng: o.subjectLng };
    const zone = findZone(subject, content.zones);
    const biotope = findBiotope(subject, content.biotopes, content.park.biotopeQueryBounds);
    const observerOutside = o.observerLat != null && o.observerLng != null && !inBounds({ lat: o.observerLat, lng: o.observerLng }, content.park.bounds);
    const now = new Date().toISOString();

    await srv.observations.put({
      id: o.id,
      householdId: uid,
      walkId: walk.id,
      observedAt: o.observedAt,
      observedAtSource: o.observedAtSource,
      createdAt: now,
      clientCreatedAt: o.clientCreatedAt,
      foundAt: o.foundAt,
      familyTaxonId: o.familyTaxonId,
      freeTextName: o.freeTextName,
      pickSource: o.pickSource,
      candidateIds: o.candidateIds,
      taxonId: o.familyTaxonId,
      idStatus: o.idStatus,
      subjectLat: o.subjectLat,
      subjectLng: o.subjectLng,
      radiusM: o.radiusM,
      locationMethod: o.locationMethod,
      distanceM: o.distanceM,
      observerLat: o.observerLat,
      observerLng: o.observerLng,
      observerAccuracyM: o.observerAccuracyM,
      zoneId: zone?.id ?? null,
      biotopeCode: biotope?.code ?? null,
      biotopeName: biotope?.name ?? null,
      biotopeYear: biotope?.year ?? null,
      biotopeSource: biotope?.source ?? null,
      outsidePark: observerOutside || !inBounds(subject, content.park.bounds),
      establishmentMeans: null,
      duplicateGroupId: null,
      hidden: false,
      hiddenReason: null,
      dateIdentified: null,
      identificationRemarks: null,
    });
    await srv.identifications.add({
      observationId: o.id,
      taxonId: o.familyTaxonId,
      status: o.idStatus,
      actor: 'household',
      reason: null,
      previousTaxonId: null,
      previousStatus: null,
      createdAt: now,
    });
    // 탐험이 먼저 끝난 채로 도착했으면(오프라인 뒤 재전송) 구역·조사 노력을 다시 계산합니다.
    const fresh = (await srv.walks.get(walk.id))!;
    const touched = { ...fresh, lastActivityAt: o.clientCreatedAt > fresh.lastActivityAt ? o.clientCreatedAt : fresh.lastActivityAt };
    await srv.walks.put(touched);
    await finalizeWalk(touched);
  },

  async uploadPhoto(p) {
    await network();
    const uid = currentUid();
    if (await srv.photos.get(p.photoId)) return;
    const ext = p.mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    await srv.photos.put({
      id: p.photoId,
      observationId: p.observationId,
      householdId: uid,
      original: p.original,
      display: p.display,
      originalPath: `${uid}/${p.observationId}/${p.photoId}-original.${ext}`,
      displayPath: p.display ? `${uid}/${p.observationId}/${p.photoId}-display.jpg` : null,
      mime: p.mime,
      exifTime: p.exifTime,
      mediaSource: p.mediaSource,
      hidden: false,
      createdAt: new Date().toISOString(),
    });
  },

  async fetchMyStatuses() {
    await network();
    await closeIdleWalks();
    const rows = await srv.observations.where('householdId').equals(currentUid()).toArray();
    return rows.map((r) => ({
      id: r.id,
      walkId: r.walkId,
      observedAt: r.observedAt,
      familyTaxonId: r.familyTaxonId,
      taxonId: r.taxonId,
      freeTextName: r.freeTextName,
      idStatus: r.idStatus,
      hidden: r.hidden,
      zoneId: r.zoneId,
      subjectLat: r.subjectLat,
      subjectLng: r.subjectLng,
      radiusM: r.radiusM,
    }));
  },

  async sendEvents(events) {
    await network();
    const uid = currentUid();
    await srv.events.bulkAdd(events.map((e) => ({ householdId: uid, name: e.name, at: e.at, props: e.props })));
  },

  async requestDeletion(reason) {
    await network();
    await srv.deletions.add({ householdId: currentUid(), requestedAt: new Date().toISOString(), reason, status: 'requested' });
  },

  async linkEmail() {
    throw new Error('로컬 모드에서는 이메일 연결을 쓸 수 없어요. Supabase를 연결하면 열려요.');
  },

  async linkedEmail() {
    return null;
  },

  async identifySpecies() {
    throw new IdentifyError('failed'); // 로컬 모드에서는 화면이 버튼을 숨깁니다.
  },
};

// ---------------- 팀 검토(로컬) ----------------

async function toAdminRows(content: Content, rows: SrvObservation[]): Promise<AdminRow[]> {
  const [households, walks, photos] = await Promise.all([srv.households.toArray(), srv.walks.toArray(), srv.photos.toArray()]);
  const hh = new Map(households.map((h) => [h.id, h]));
  const ww = new Map(walks.map((w) => [w.id, w]));
  return rows.map((r) => {
    const taxon = taxonById(content, r.taxonId);
    return {
      id: r.id,
      walk_id: r.walkId,
      observed_at: r.observedAt,
      household_no: hh.get(r.householdId)?.no ?? 0,
      vernacular_name: taxon?.koreanName ?? null,
      scientific_name: taxon?.scientificName ?? null,
      family_vernacular_name: taxonById(content, r.familyTaxonId)?.koreanName ?? null,
      free_text_name: r.freeTextName,
      id_status: r.idStatus,
      subject_lat: r.subjectLat,
      subject_lng: r.subjectLng,
      radius_m: r.radiusM,
      location_method: r.locationMethod,
      distance_m: r.distanceM,
      observer_lat: r.observerLat,
      observer_lng: r.observerLng,
      observer_accuracy_m: r.observerAccuracyM,
      zone_id: r.zoneId,
      zone_name: zoneById(content, r.zoneId)?.name ?? null,
      outside_park: r.outsidePark,
      biotope_code: r.biotopeCode,
      biotope_name: r.biotopeName,
      biotope_year: r.biotopeYear,
      biotope_source: r.biotopeSource,
      effort_text: ww.get(r.walkId)?.effortText ?? null,
      establishment_means: r.establishmentMeans,
      date_identified: r.dateIdentified,
      identification_remarks: r.identificationRemarks,
      duplicate_group_id: r.duplicateGroupId,
      photo_paths: photos.filter((p) => p.observationId === r.id && !p.hidden).map((p) => p.originalPath),
      hidden: r.hidden,
      taxon_id: r.taxonId,
      family_taxon_id: r.familyTaxonId,
      candidate_ids: r.candidateIds,
      pick_source: r.pickSource,
      created_at: r.createdAt,
      client_created_at: r.clientCreatedAt,
      found_at: r.foundAt,
      hidden_reason: r.hiddenReason,
    };
  });
}

function matchFilters(r: SrvObservation, f: AdminFilters): boolean {
  const day = kstDate(r.observedAt);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.statuses?.length && !f.statuses.includes(r.idStatus)) return false;
  if (!f.includeHidden && r.hidden) return false;
  return true;
}

async function filteredRows(filters: AdminFilters): Promise<AdminRow[]> {
  const content = await loadContent();
  await closeIdleWalks();
  const rows = (await srv.observations.toArray()).filter((r) => matchFilters(r, filters));
  rows.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return toAdminRows(content, rows);
}

async function historyRows(content: Content, observationIds: string[]): Promise<HistoryRow[]> {
  const rows = await srv.identifications.where('observationId').anyOf(observationIds).toArray();
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rows.map((h) => ({
    observation_id: h.observationId,
    created_at: h.createdAt,
    actor: h.actor,
    vernacular_name: taxonById(content, h.taxonId)?.koreanName ?? null,
    scientific_name: taxonById(content, h.taxonId)?.scientificName ?? null,
    status: h.status,
    previous_vernacular_name: taxonById(content, h.previousTaxonId)?.koreanName ?? null,
    previous_status: h.previousStatus,
    reason: h.reason,
  }));
}

export const localAdmin: AdminBackend = {
  mode: 'local',

  async currentUser() {
    return { email: '로컬 모드 검토자' };
  },
  async signIn() {},
  async signOut() {},

  listObservations: filteredRows,

  async listPhotos(observationId) {
    const photos = await srv.photos.where('observationId').equals(observationId).toArray();
    return photos.map((p) => {
      const blob = p.display ?? p.original;
      return { id: p.id, url: blob ? URL.createObjectURL(blob) : null, hidden: p.hidden, mediaSource: p.mediaSource, exifTime: p.exifTime };
    });
  },

  async setPhotoHidden(photoId, hidden) {
    await srv.photos.update(photoId, { hidden });
  },

  async history(observationId) {
    return historyRows(await loadContent(), [observationId]);
  },

  async review(id, changes) {
    const row = await srv.observations.get(id);
    if (!row) throw new Error('기록이 없어요');
    const next = { ...row };
    const now = new Date().toISOString();
    if (changes.taxonId !== undefined || changes.status !== undefined) {
      next.taxonId = changes.taxonId !== undefined ? changes.taxonId : row.taxonId;
      next.idStatus = changes.status ?? row.idStatus;
      next.dateIdentified = now;
      next.identificationRemarks = changes.reason || row.identificationRemarks;
      await srv.identifications.add({
        observationId: id,
        taxonId: next.taxonId,
        status: next.idStatus,
        actor: 'reviewer',
        reason: changes.reason ?? null,
        previousTaxonId: row.taxonId,
        previousStatus: row.idStatus,
        createdAt: now,
      });
    }
    if (changes.hidden !== undefined) {
      next.hidden = changes.hidden;
      next.hiddenReason = changes.hidden ? (changes.hiddenReason ?? null) : null;
    }
    if (changes.establishmentMeans !== undefined) next.establishmentMeans = changes.establishmentMeans;
    await srv.observations.put(next);
  },

  async duplicateCandidates(id) {
    const row = await srv.observations.get(id);
    if (!row?.taxonId) return [];
    const near = (await srv.observations.toArray()).filter(
      (o) =>
        o.id !== id &&
        o.taxonId === row.taxonId &&
        Math.abs(Date.parse(o.observedAt) - Date.parse(row.observedAt)) <= 10 * 60_000 &&
        distanceM({ lat: o.subjectLat, lng: o.subjectLng }, { lat: row.subjectLat, lng: row.subjectLng }) <= 30,
    );
    return toAdminRows(await loadContent(), near);
  },

  async groupDuplicates(ids) {
    const rows = (await srv.observations.bulkGet(ids)).filter((r): r is SrvObservation => !!r);
    const group = rows.find((r) => r.duplicateGroupId)?.duplicateGroupId ?? uuid();
    await Promise.all(rows.map((r) => srv.observations.update(r.id, { duplicateGroupId: group })));
    return group;
  },

  async ungroup(id) {
    await srv.observations.update(id, { duplicateGroupId: null });
  },

  async exportCsv(kind, filters) {
    const rows = await filteredRows({ ...filters, includeHidden: false });
    const csv =
      kind === 'observations'
        ? toCsv(DWC_COLUMNS, rows.map(observationToDwc))
        : toCsv(HISTORY_COLUMNS, (await historyRows(await loadContent(), rows.map((r) => r.id))).map(historyToRow));
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  },

  async listWalks() {
    return (await srv.walks.toArray()).map((w) => ({ id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, lastActivityAt: w.lastActivityAt }));
  },

  async listDeletionRequests() {
    const [rows, households] = await Promise.all([srv.deletions.toArray(), srv.households.toArray()]);
    const no = new Map(households.map((h) => [h.id, h.no]));
    return rows.map((d) => ({ id: d.id!, householdNo: no.get(d.householdId) ?? 0, requestedAt: d.requestedAt, reason: d.reason, status: d.status }));
  },
};
