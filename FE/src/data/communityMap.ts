import { useEffect, useState } from 'react';
import { getFamilyBackend } from '../backend';
import type { CommunityCell } from '../backend/types';
import { BACKEND_MODE } from '../config';
import { useOnline } from '../hooks';

let latest: CommunityCell[] = [];

export function useCommunityMap(): CommunityCell[] {
  const [cells, setCells] = useState(latest);
  const online = useOnline();
  useEffect(() => {
    if (BACKEND_MODE !== 'supabase' || !online) return;
    let active = true;
    let stop: (() => void) | undefined;
    let inFlight = false;
    let again = false;

    const refresh = async () => {
      if (!active) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const backend = await getFamilyBackend();
        const rows = await backend.fetchCommunityMap();
        if (active) {
          latest = rows;
          setCells(rows);
        }
      } catch {
        // 연결이 돌아오면 마지막으로 본 집계를 갱신합니다.
      } finally {
        inFlight = false;
        if (active && again) {
          again = false;
          void refresh();
        }
      }
    };

    void getFamilyBackend().then((backend) => {
      if (active) stop = backend.watchCommunityMap(() => void refresh());
    }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      stop?.();
      window.clearInterval(timer);
    };
  }, [online]);
  return cells;
}
