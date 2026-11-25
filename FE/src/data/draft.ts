import { MAX_PHOTOS } from '../config';
import { makeDisplayCopy, readExifTime } from '../lib/photo';
import { packBlobs, withBytes } from './blobBytes';
import { nowIso } from '../lib/time';
import { uuid } from '../lib/uuid';
import { db } from './db';
import { track } from './track';
import type { DraftPhoto, MediaSource, ObserverFix, PickSource, RecordDraft } from './types';

/** ‘찾았어요’(생물 카드) 또는 기록하기 탭에서 새 기록을 시작합니다. */
export async function startDraft(sourceTaxonId: string | null): Promise<RecordDraft> {
  const draft: RecordDraft = {
    id: 'current',
    draftId: uuid(),
    foundAt: nowIso(),
    sourceTaxonId,
    photos: [],
    observer: null,
    candidateIds: [],
    taxonId: null,
    freeTextName: null,
    pickSource: null,
  };
  await db.drafts.put(draft);
  track('record_found', { draftId: draft.draftId, from: sourceTaxonId ? 'card' : 'tab' });
  return draft;
}

export async function getOrStartDraft(): Promise<RecordDraft> {
  return (await db.drafts.get('current')) ?? startDraft(null);
}

export async function updateDraft(changes: Partial<Omit<RecordDraft, 'id'>>): Promise<void> {
  await db.drafts.update('current', changes);
}

export async function discardDraft(): Promise<void> {
  await db.drafts.delete('current');
}

/** 고른 사진을 기기에 바로 넣습니다(원본 그대로 + 화면용 사본). */
export async function addPhotos(files: File[], mediaSource: MediaSource, replace = false): Promise<number> {
  const draft = await db.drafts.get('current');
  if (!draft) return 0;
  const room = replace ? MAX_PHOTOS : MAX_PHOTOS - draft.photos.length;
  const added: DraftPhoto[] = [];
  for (const file of files.slice(0, room)) {
    try {
      const [exifTime, display] = await Promise.all([readExifTime(file), makeDisplayCopy(file)]);
      // 원본·화면용 모두 바이트로 읽어 둡니다(iOS에서 IndexedDB의 Blob이 깨지는 문제 대응).
      const [original, displayBytes] = await Promise.all([withBytes(file), display ? withBytes(display).catch(() => null) : null]);
      added.push({
      id: uuid(),
      original,
      display: displayBytes,
      mime: file.type || 'application/octet-stream',
      exifTime,
      mediaSource,
      capturedAt: nowIso(),
      });
    } catch (err) {
      console.warn('addPhotos: skipped a photo', { type: file.type, size: file.size, reason: err instanceof Error ? err.message : 'unknown' });
    }
  }
  if (!added.length) return 0;
  return db.transaction('rw', db.drafts, async () => {
    const latest = await db.drafts.get('current');
    if (latest?.draftId !== draft.draftId) return 0;
    const existing = replace ? [] : latest.photos;
    const photos = [...existing, ...added].slice(0, MAX_PHOTOS);
    await db.drafts.update('current', { photos: packBlobs(photos) });
    return photos.length - existing.length;
  });
}

export async function removePhoto(photoId: string): Promise<void> {
  const draft = await db.drafts.get('current');
  if (draft) await db.drafts.update('current', { photos: packBlobs(draft.photos.filter((p) => p.id !== photoId)) });
}

export async function setObserver(draftId: string, observer: ObserverFix): Promise<void> {
  await db.drafts.where('id').equals('current').and((draft) => draft.draftId === draftId).modify({ observer });
}

export async function pickTaxon(taxonId: string | null, pickSource: PickSource, freeTextName: string | null = null): Promise<void> {
  const draft = await db.drafts.get('current');
  await db.drafts.update('current', { taxonId, pickSource, freeTextName });
  if (draft) track('record_pick', { draftId: draft.draftId, pickSource });
}
