import { MAX_PHOTOS } from '../config';
import { makeDisplayCopy, readExifTime } from '../lib/photo';
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
export async function addPhotos(files: File[], mediaSource: MediaSource): Promise<void> {
  const draft = await db.drafts.get('current');
  if (!draft) return;
  const room = MAX_PHOTOS - draft.photos.length;
  const added: DraftPhoto[] = [];
  for (const file of files.slice(0, room)) {
    const [exifTime, display] = await Promise.all([readExifTime(file), makeDisplayCopy(file)]);
    added.push({
      id: uuid(),
      original: file,
      display,
      mime: file.type || 'application/octet-stream',
      exifTime,
      mediaSource,
      capturedAt: nowIso(),
    });
  }
  const latest = await db.drafts.get('current');
  if (latest) await db.drafts.update('current', { photos: [...latest.photos, ...added].slice(0, MAX_PHOTOS) });
}

export async function removePhoto(photoId: string): Promise<void> {
  const draft = await db.drafts.get('current');
  if (draft) await db.drafts.update('current', { photos: draft.photos.filter((p) => p.id !== photoId) });
}

export async function setObserver(observer: ObserverFix | null): Promise<void> {
  await db.drafts.update('current', { observer });
}

export async function pickTaxon(taxonId: string | null, pickSource: PickSource, freeTextName: string | null = null): Promise<void> {
  const draft = await db.drafts.get('current');
  await db.drafts.update('current', { taxonId, pickSource, freeTextName });
  if (draft) track('record_pick', { draftId: draft.draftId, pickSource });
}
