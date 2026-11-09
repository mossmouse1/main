import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useContent } from './content/ContentProvider';
import { activeSeason } from './content/helpers';
import { db, getMeta } from './data/db';
import type { Household, LocalWalk } from './data/types';
import { computeDex, type DexState } from './lib/dex';

/** undefined = 읽는 중, null = 아직 없음 */
export function useHousehold(): Household | null | undefined {
  const row = useLiveQuery(async () => ({ h: (await getMeta('household')) ?? null }), []);
  return row?.h;
}

export function usePendingCount(): number {
  return useLiveQuery(() => db.observations.where('sync').equals('pending').count(), [], 0);
}

export function useActiveWalk(): LocalWalk | null | undefined {
  const row = useLiveQuery(async () => {
    const walks = await db.walks.orderBy('startedAt').reverse().limit(5).toArray();
    return { w: walks.find((w) => !w.endedAt) ?? null };
  }, []);
  return row?.w;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useSeason() {
  const { content } = useContent();
  return useMemo(() => activeSeason(content), [content]);
}

export function useDex(): DexState | undefined {
  const { content } = useContent();
  const season = useSeason();
  const data = useLiveQuery(async () => {
    const [observations, seen] = await Promise.all([db.observations.toArray(), getMeta('dexSeen')]);
    return { observations, seen: seen?.[season.id] ?? [] };
  }, [season.id]);
  return useMemo(() => (data ? computeDex(content, season, data.observations, data.seen) : undefined), [content, season, data]);
}

/** Blob을 화면에 보여 줄 URL로. 화면을 떠나면 놓아 줍니다. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
