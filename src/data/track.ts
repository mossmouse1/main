import { nowIso } from '../lib/time';
import { db } from './db';
import { enqueue } from './sync';
import type { UsageEvent } from './types';

/**
 * 사용 기록: 화면 진입과 기록 단계별 시각만, 익명 가족 단위로 남깁니다.
 * 동의 전에는 기기에만 두고 보내지 않습니다(sync.ts).
 */
export function track(name: string, props: UsageEvent['props'] = {}): void {
  db.events
    .add({ name, at: nowIso(), props })
    .then(() => enqueue({ kind: 'events', refId: 'events' }, { kick: false }))
    .catch(() => {});
}
