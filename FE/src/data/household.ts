import { CONSENT_VERSION } from '../config';
import { uuid } from '../lib/uuid';
import { requestPersistentStorage } from '../platform';
import { db, getMeta, setMeta } from './db';
import { kickSync } from './sync';
import type { Household } from './types';

/** 기기 쪽 가족 정보. 이름·연락처·아이 정보는 받지 않습니다. */
export async function getHousehold(): Promise<Household> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta('household');
    if (existing) return existing;
    const created: Household = { id: uuid(), consentVersion: null, consentedAt: null, adults: null, children: null };
    await setMeta('household', created);
    return created;
  });
}

export const hasConsent = (h: Household | undefined) => !!h?.consentedAt;

export async function saveConsent(adults: number | null, children: number | null): Promise<void> {
  const h = await getHousehold();
  await setMeta('household', { ...h, consentVersion: CONSENT_VERSION, consentedAt: new Date().toISOString(), adults, children });
  // 동의는 다음 동기화 때 서버 계정으로 보냅니다.
  await setMeta('consentSyncedFor', '');
  void requestPersistentStorage();
  kickSync();
}

export async function setPartyDefaults(adults: number | null, children: number | null): Promise<void> {
  const h = await getHousehold();
  await setMeta('household', { ...h, adults, children });
}
