import { WALK_IDLE_MS, WALK_MAX_MS } from '../config';
import { effortText } from '../lib/effort';
import { minutesBetween, nowIso } from '../lib/time';
import { uuid } from '../lib/uuid';
import { db } from './db';
import { getHousehold } from './household';
import { enqueue } from './sync';
import { track } from './track';
import type { LocalWalk } from './types';

async function openWalk(): Promise<LocalWalk | null> {
  const walks = await db.walks.orderBy('startedAt').reverse().limit(5).toArray();
  return walks.find((w) => !w.endedAt) ?? null;
}

/**
 * 30분 동안 활동이 없거나 3시간이 지나면 탐험을 자동으로 끝냅니다.
 * 끝낸 시각은 마지막 활동 시각입니다(조사 노력이 부풀지 않게).
 */
export async function checkAutoEnd(now = Date.now()): Promise<LocalWalk | null> {
  const walk = await openWalk();
  if (!walk) return null;
  const idle = now - Date.parse(walk.lastActivityAt) > WALK_IDLE_MS;
  const tooLong = now - Date.parse(walk.startedAt) > WALK_MAX_MS;
  if (!idle && !tooLong) return null;
  const endedAt = new Date(Math.min(Date.parse(walk.lastActivityAt), Date.parse(walk.startedAt) + WALK_MAX_MS)).toISOString();
  return endWalk(walk.id, 'auto', endedAt);
}

export async function getActiveWalk(): Promise<LocalWalk | null> {
  await checkAutoEnd();
  return openWalk();
}

export async function startWalk(opts: { adults: number | null; children: number | null; startedAt?: string }): Promise<LocalWalk> {
  const active = await getActiveWalk();
  if (active) return active;
  const startedAt = opts.startedAt ?? nowIso();
  const walk: LocalWalk = {
    id: uuid(),
    startedAt,
    endedAt: null,
    endedBy: null,
    lastActivityAt: startedAt,
    adults: opts.adults,
    children: opts.children,
    zoneIds: [],
    effortText: null,
    summarySeen: false,
  };
  await db.walks.add(walk);
  await enqueue({ kind: 'walk', refId: walk.id });
  track('walk_start', { walkId: walk.id, manual: !opts.startedAt });
  return walk;
}

/** 첫 기록을 저장할 때 탐험이 없으면 자동으로 시작합니다. */
export async function ensureWalk(startedAt: string): Promise<LocalWalk> {
  const active = await getActiveWalk();
  if (active) return active;
  const h = await getHousehold();
  return startWalk({ adults: h.adults, children: h.children, startedAt });
}

let lastTouch = 0;
/** 화면을 쓰는 동안 마지막 활동 시각을 남깁니다(1분에 한 번만). */
export async function touchWalk(force = false): Promise<void> {
  if (!force && Date.now() - lastTouch < 60_000) return;
  lastTouch = Date.now();
  const walk = await openWalk();
  if (walk) await db.walks.update(walk.id, { lastActivityAt: nowIso() });
}

export async function endWalk(id: string, by: 'manual' | 'auto', endedAt = nowIso()): Promise<LocalWalk> {
  const walk = await db.walks.get(id);
  if (!walk) throw new Error('탐험을 찾을 수 없어요');
  if (walk.endedAt) return walk;
  const obs = await db.observations.where('walkId').equals(id).toArray();
  const zoneIds = [...new Set(obs.map((o) => o.zoneId).filter((z): z is string => !!z))].sort();
  const ended: LocalWalk = {
    ...walk,
    endedAt,
    endedBy: by,
    zoneIds,
    effortText: effortText({ adults: walk.adults, children: walk.children, minutes: minutesBetween(walk.startedAt, endedAt), zoneIds }),
  };
  await db.walks.put(ended);
  await enqueue({ kind: 'walk', refId: id });
  track('walk_end', { walkId: id, by, records: obs.length });
  return ended;
}
