import type { Content } from '../content/types';
import { distanceM, findBiotope, findZone, inBounds, type LatLng } from '../lib/geo';
import { nowIso } from '../lib/time';
import { uuid } from '../lib/uuid';
import { db } from './db';
import { enqueue, kickSync } from './sync';
import { track } from './track';
import type { LocalObservation, LocalPhoto, LocationMethod, RecordDraft } from './types';
import { ensureWalk, touchWalk } from './walks';

/**
 * 기록을 기기에 먼저 저장하고(0.3초 안에 완료 화면), 전송은 대기열이 뒤에서 합니다.
 * 구역·비오톱은 화면 표시용으로 여기서도 계산하지만, 내보내기 값은 서버가 다시 계산합니다.
 */
export async function saveObservation(
  content: Content,
  draft: RecordDraft,
  where: { subject: LatLng; radiusM: number; method: LocationMethod },
): Promise<LocalObservation> {
  const walk = await ensureWalk(draft.foundAt);
  const id = uuid();
  const createdAt = nowIso();
  const first = draft.photos[0];
  const observer = draft.observer;
  const zone = findZone(where.subject, content.zones);
  const biotope = findBiotope(where.subject, content.biotopes, content.park.biotopeQueryBounds);

  const obs: LocalObservation = {
    id,
    walkId: walk.id,
    createdAt,
    observedAt: first?.exifTime ?? first?.capturedAt ?? createdAt,
    observedAtSource: first?.exifTime ? 'exif' : 'device',
    familyTaxonId: draft.taxonId,
    taxonId: draft.taxonId,
    freeTextName: draft.freeTextName,
    pickSource: draft.pickSource ?? 'unknown',
    candidateIds: draft.candidateIds,
    idStatus: draft.taxonId ? 'family' : 'unidentified',
    observer,
    subject: where.subject,
    radiusM: where.radiusM,
    locationMethod: where.method,
    distanceM: observer && where.method === 'tap' ? Math.round(distanceM(observer, where.subject)) : null,
    zoneId: zone?.id ?? null,
    biotopeCode: biotope?.code ?? null,
    outsidePark: !inBounds(where.subject, content.park.bounds) || (!!observer && !inBounds(observer, content.park.bounds)),
    photoIds: draft.photos.map((p) => p.id),
    sync: 'pending',
    hidden: false,
    reviewChanged: false,
    reviewSeen: true,
    foundAt: draft.foundAt,
  };
  const photos: LocalPhoto[] = draft.photos.map((p) => ({
    id: p.id,
    observationId: id,
    original: p.original,
    display: p.display,
    mime: p.mime,
    exifTime: p.exifTime,
    mediaSource: p.mediaSource,
    uploaded: false,
  }));

  await db.transaction('rw', [db.observations, db.photos, db.drafts, db.outbox], async () => {
    await db.observations.add(obs);
    await db.photos.bulkAdd(photos);
    await db.drafts.delete('current');
    await enqueue({ kind: 'observation', refId: id, obsId: id }, { kick: false });
    for (const p of photos) await enqueue({ kind: 'photo', refId: p.id, obsId: id }, { kick: false });
  });
  await touchWalk(true);
  track('record_saved', { draftId: draft.draftId, ms: Date.parse(createdAt) - Date.parse(draft.foundAt), photos: photos.length });
  kickSync();
  return obs;
}
