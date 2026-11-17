import { distanceM } from '../lib/geo';
import type { ObserverFix } from './types';
import { getMeta, setMeta } from './db';

/** 지도에 그리는 ‘내가 걸어온 길’. 기기에만 두고 서버로 보내지 않습니다. [lat, lng, 시각(ms)] */
export type TrackPoint = [number, number, number];

/** 3시간이 지난 점은 지웁니다(탐험 최대 길이와 같음). */
const KEEP_MS = 3 * 60 * 60 * 1000;
/** GPS 오차가 이보다 크면 길로 남기지 않습니다. */
const MAX_ACCURACY_M = 35;
/** 이만큼 움직여야 새 점을 남깁니다(제자리 흔들림 무시). */
const MIN_STEP_M = 8;
/** 한 번에 이보다 멀리 뛰면 GPS 튐으로 보고 버립니다. */
const MAX_JUMP_M = 400;

let cache: TrackPoint[] | null = null;
const listeners = new Set<(pts: TrackPoint[]) => void>();

export async function loadTrack(now = Date.now()): Promise<TrackPoint[]> {
  if (!cache) cache = ((await getMeta('trackLog')) ?? []).filter((p) => now - p[2] < KEEP_MS);
  return cache;
}

/** 새 위치를 길에 보탭니다. 바뀌었으면 true */
export async function appendFix(fix: ObserverFix): Promise<boolean> {
  if (fix.accuracy > MAX_ACCURACY_M) return false;
  const now = Date.parse(fix.at) || Date.now();
  const pts = await loadTrack(now);
  const last = pts[pts.length - 1];
  if (last) {
    const d = distanceM({ lat: last[0], lng: last[1] }, fix);
    if (d < MIN_STEP_M) return false;
    // 오래 끊겼다가 다시 켠 경우는 새로 시작하는 선이라 튐 검사를 하지 않습니다.
    if (d > MAX_JUMP_M && now - last[2] < 60_000) return false;
  }
  cache = [...pts.filter((p) => now - p[2] < KEEP_MS), [fix.lat, fix.lng, now]];
  await setMeta('trackLog', cache).catch(() => {});
  listeners.forEach((f) => f(cache!));
  return true;
}

export function onTrack(f: (pts: TrackPoint[]) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** since 이후 걸은 거리(m). 10분 넘게 끊긴 구간은 더하지 않습니다. */
export function walkedMeters(pts: TrackPoint[], since: number): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a[2] < since || b[2] - a[2] > 10 * 60_000) continue;
    m += distanceM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }
  return m;
}

/** 지도에 그릴 선: 10분 넘게 끊긴 곳에서 나눕니다. */
export function trackSegments(pts: TrackPoint[]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0 && p[2] - pts[i - 1][2] > 10 * 60_000) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push([p[0], p[1]]);
  });
  if (cur.length > 1) out.push(cur);
  return out;
}
