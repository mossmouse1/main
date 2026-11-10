/**
 * 전송 대기열. 기록과 사진은 기기(IndexedDB)에 먼저 저장하고, 여기서 뒤에서 올립니다.
 * - 서버가 받았다고 확인한 뒤에만 대기열에서 지우고, 사진 원본도 그때 지웁니다.
 * - 실패하면 간격을 늘려 가며 다시 보냅니다(5초 → 최대 10분).
 * - 서비스 워커 없이 동작합니다(iOS 웹뷰 대응).
 */
import { getFamilyBackend } from '../backend';
import type { FamilyBackend } from '../backend/types';
import { isOnline } from '../platform';
import { nowIso } from '../lib/time';
import { db, getMeta, setMeta } from './db';
import type { LocalObservation, OutboxItem, OutboxKind } from './types';

const MAX_BACKOFF_MS = 10 * 60_000;
const PULL_INTERVAL_MS = 60_000;
const backoff = (attempts: number) => Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (attempts - 1)) * (0.8 + Math.random() * 0.4);

/** 같은 대상(탐험·이벤트 묶음)이 이미 대기 중이면 새로 넣지 않습니다. 보낼 때 최신 상태를 읽기 때문입니다. */
const DEDUPED: OutboxKind[] = ['walk', 'events'];

export async function enqueue(item: { kind: OutboxKind; refId: string; obsId?: string }, opts = { kick: true }): Promise<void> {
  if (DEDUPED.includes(item.kind)) {
    const pending = await db.outbox.where('refId').equals(item.refId).filter((x) => x.kind === item.kind).count();
    if (pending) return;
  }
  await db.outbox.add({ ...item, createdAt: nowIso(), attempts: 0, nextAttemptAt: 0 });
  if (opts.kick) kickSync();
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastPull = 0;

export function kickSync(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } catch (err) {
      console.warn('[sync]', err);
    } finally {
      running = false;
      await scheduleNext();
    }
  })();
}

/** 연결이 돌아오면 기다리지 않고 바로 다시 보냅니다. */
export async function retryNow(): Promise<void> {
  await db.outbox.toCollection().modify({ nextAttemptAt: 0 });
  lastPull = 0;
  kickSync();
}

async function scheduleNext(): Promise<void> {
  clearTimeout(timer);
  const items = await db.outbox.toArray();
  if (!items.length) return;
  const next = Math.min(...items.map((i) => i.nextAttemptAt));
  timer = setTimeout(kickSync, Math.max(1000, next - Date.now()));
}

export function startSync(): () => void {
  const onOnline = () => void retryNow();
  const onVisible = () => document.visibilityState === 'visible' && kickSync();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(kickSync, 30_000);
  kickSync();
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    clearTimeout(timer);
  };
}

async function runOnce(): Promise<void> {
  if (!isOnline()) return;
  const backend = await getFamilyBackend();
  const uid = await backend.ensureAuth();
  const household = await getMeta('household');
  const consented = !!household?.consentedAt;

  // 계정이 새로 만들어졌으면(저장소가 지워진 경우 등) 동의를 그 계정으로 다시 보냅니다.
  if (consented && (await getMeta('consentSyncedFor')) !== uid) {
    await backend.registerConsent({
      version: household.consentVersion!,
      consentedAt: household.consentedAt!,
      adults: household.adults,
      children: household.children,
    });
    await setMeta('consentSyncedFor', uid);
  }
  await setMeta('serverUid', uid);
  if (!consented) return; // 동의 전에는 아무것도 보내지 않습니다.

  const items = await db.outbox.orderBy('id').toArray();
  const blocked = new Set<string>();
  for (const item of items) {
    if (!isOnline()) return;
    // 앞 단계(기록)가 실패한 사진은 이번에는 건너뜁니다.
    if (item.obsId && blocked.has(item.obsId)) continue;
    if (item.nextAttemptAt > Date.now()) {
      if (item.obsId) blocked.add(item.obsId);
      continue;
    }
    try {
      await send(backend, item);
      await db.outbox.delete(item.id!);
      await afterSent(item);
    } catch (err) {
      const attempts = item.attempts + 1;
      await db.outbox.update(item.id!, {
        attempts,
        nextAttemptAt: Date.now() + backoff(attempts),
        lastError: err instanceof Error ? err.message : String(err),
      });
      if (item.obsId) blocked.add(item.obsId);
    }
  }

  if (Date.now() - lastPull > PULL_INTERVAL_MS) {
    lastPull = Date.now();
    await pullStatuses(backend);
  }
}

async function send(backend: FamilyBackend, item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'walk': {
      const w = await db.walks.get(item.refId);
      if (!w) return;
      const payload = { id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, endedBy: w.endedBy, adults: w.adults, children: w.children };
      await backend.startWalk(payload);
      if (w.endedAt) await backend.endWalk(payload);
      return;
    }
    case 'observation': {
      const o = await db.observations.get(item.refId);
      if (!o) return;
      const w = await db.walks.get(o.walkId);
      await backend.upsertObservation({
        id: o.id,
        walk: { id: o.walkId, startedAt: w?.startedAt ?? o.foundAt, adults: w?.adults ?? null, children: w?.children ?? null },
        observedAt: o.observedAt,
        observedAtSource: o.observedAtSource,
        clientCreatedAt: o.createdAt,
        foundAt: o.foundAt,
        familyTaxonId: o.familyTaxonId,
        freeTextName: o.freeTextName,
        pickSource: o.pickSource,
        candidateIds: o.candidateIds,
        idStatus: o.familyTaxonId ? 'family' : 'unidentified',
        subjectLat: o.subject.lat,
        subjectLng: o.subject.lng,
        radiusM: o.radiusM,
        locationMethod: o.locationMethod,
        distanceM: o.distanceM,
        observerLat: o.observer?.lat ?? null,
        observerLng: o.observer?.lng ?? null,
        observerAccuracyM: o.observer?.accuracy ?? null,
      });
      return;
    }
    case 'photo': {
      const p = await db.photos.get(item.refId);
      if (!p) return;
      await backend.uploadPhoto({
        photoId: p.id,
        observationId: p.observationId,
        original: p.original,
        display: p.display,
        mime: p.mime,
        exifTime: p.exifTime,
        mediaSource: p.mediaSource,
      });
      return;
    }
    case 'events': {
      const events = await db.events.orderBy('id').limit(200).toArray();
      if (events.length) {
        await backend.sendEvents(events);
        await db.events.bulkDelete(events.map((e) => e.id!));
      }
      if (await db.events.count()) await db.outbox.add({ kind: 'events', refId: 'events', createdAt: nowIso(), attempts: 0, nextAttemptAt: 0 });
      return;
    }
    case 'deletion':
      await backend.requestDeletion(item.refId);
      return;
  }
}

async function afterSent(item: OutboxItem): Promise<void> {
  if (item.kind === 'photo') {
    // 서버가 받은 것을 확인했으니 원본은 지우고 화면용 사본만 남깁니다.
    await db.photos.update(item.refId, { uploaded: true, original: null });
  }
  if (item.obsId && (await db.outbox.where('obsId').equals(item.obsId).count()) === 0) {
    await db.observations.update(item.obsId, { sync: 'sent' });
  }
}

/** 팀 검토 결과를 받아 도감에 반영합니다. 기기에 없는 기록(저장소가 지워진 뒤 이어 쓰기)은 되살립니다. */
async function pullStatuses(backend: FamilyBackend): Promise<void> {
  const statuses = await backend.fetchMyStatuses();
  await db.transaction('rw', db.observations, async () => {
    for (const s of statuses) {
      const local = await db.observations.get(s.id);
      if (!local) {
        const restored: LocalObservation = {
          id: s.id,
          walkId: s.walkId,
          createdAt: s.observedAt,
          observedAt: s.observedAt,
          observedAtSource: 'device',
          familyTaxonId: s.familyTaxonId,
          taxonId: s.taxonId,
          freeTextName: s.freeTextName,
          pickSource: s.familyTaxonId ? 'card' : 'unknown',
          candidateIds: [],
          idStatus: s.idStatus,
          observer: null,
          subject: { lat: s.subjectLat, lng: s.subjectLng },
          radiusM: s.radiusM,
          locationMethod: 'tap',
          distanceM: null,
          zoneId: s.zoneId,
          biotopeCode: null,
          outsidePark: false,
          photoIds: [],
          sync: 'sent',
          hidden: s.hidden,
          reviewChanged: false,
          reviewSeen: true,
          foundAt: s.observedAt,
        };
        await db.observations.put(restored);
        continue;
      }
      const taxonChanged = s.taxonId !== local.taxonId;
      if (!taxonChanged && s.idStatus === local.idStatus && s.hidden === local.hidden) continue;
      await db.observations.update(s.id, {
        idStatus: s.idStatus,
        taxonId: s.taxonId,
        hidden: s.hidden,
        ...(taxonChanged ? { reviewChanged: s.taxonId !== local.familyTaxonId, reviewSeen: false } : {}),
      });
    }
  });
}
