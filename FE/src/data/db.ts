import Dexie, { type EntityTable } from 'dexie';
import { reviveBlobs } from './blobBytes';
import type {
  Household,
  LocalObservation,
  LocalPhoto,
  LocalWalk,
  OutboxItem,
  RecordDraft,
  UsageEvent,
} from './types';

interface MetaRow {
  key: string;
  value: unknown;
}

interface AssetRow {
  key: string;
  blob: Blob;
}

export const db = new Dexie('parkdex') as Dexie & {
  meta: EntityTable<MetaRow, 'key'>;
  walks: EntityTable<LocalWalk, 'id'>;
  observations: EntityTable<LocalObservation, 'id'>;
  photos: EntityTable<LocalPhoto, 'id'>;
  drafts: EntityTable<RecordDraft, 'id'>;
  outbox: EntityTable<OutboxItem, 'id'>;
  events: EntityTable<UsageEvent, 'id'>;
  assets: EntityTable<AssetRow, 'key'>;
};

db.version(1).stores({
  meta: 'key',
  walks: 'id, startedAt',
  observations: 'id, walkId, createdAt, sync, taxonId',
  photos: 'id, observationId',
  drafts: 'id',
  outbox: '++id, kind, refId, obsId',
  events: '++id',
  assets: 'key',
});

// 사진은 바이트로 저장하고(blobBytes.ts) 읽을 때 Blob으로 되살립니다. 옛 Blob 데이터도 그대로 읽힙니다.
db.drafts.hook('reading', (row) => reviveBlobs(row));
db.photos.hook('reading', (row) => reviveBlobs(row));

export interface MetaValues {
  household: Household;
  onboarded: boolean;
  /** 계절 세트별로 가족이 이미 본(NEW가 지난) 칸 */
  dexSeen: Record<string, string[]>;
  /** 서버 계정 id와, 동의가 그 계정으로 전송됐는지 */
  serverUid: string;
  consentSyncedFor: string;
  /** 지도 탐험 가이드·촬영 첫 안내를 봤는지 */
  tourSeen: boolean;
  cameraTipSeen: boolean;
  /** 지도에 그리는 내가 걸어온 길(최근 3시간, 기기에만 둠). data/trackLog.ts */
  trackLog: [number, number, number][];
}

// meta에는 이 밖에 'content'(콘텐츠 사본)도 들어갑니다(content/load.ts).

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value });
}
