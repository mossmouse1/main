import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { db, getMeta, setMeta } from '../data/db';
import { getHousehold } from '../data/household';
import { kstDate } from '../lib/time';
import { buildTrailGraph, type TrailGraph } from '../lib/trail';
import { activeSeason, questSpecies, taxonById } from './helpers';
import { loadContent, loadIsoImageUrl, loadMapImageUrl, loadTrails } from './load';
import type { Content, SeasonSet } from './types';

interface ContentState {
  content: Content;
  mapUrl: string;
  /** 지도 홈의 쿼터뷰 블록 지도(없으면 null) */
  isoUrl: string | null;
  /** 산책로 그래프(못 받았으면 점 0개) */
  trails: TrailGraph;
  season: SeasonSet;
  familyId: string;
}

const ContentContext = createContext<ContentState | null>(null);

async function assignSeason(content: Content, familyId: string): Promise<SeasonSet> {
  const season = activeSeason(content);
  const ids = await db.transaction('rw', db.meta, async () => {
    const stored = await getMeta('questSpecies') ?? {};
    const list = stored[season.id];
    const prior = list?.length === 10 ? list.filter((id) => !!taxonById(content, id)) : [];
    const picked = [...new Set([...prior, ...questSpecies(content, season, familyId)])].slice(0, 10);
    if (picked.join() !== stored[season.id]?.join()) await setMeta('questSpecies', { ...stored, [season.id]: picked });
    return picked;
  });
  return { ...season, dex: ids, todaySix: ids };
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContentState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadContent()
      .then(async (content) => {
        const [mapUrl, isoUrl, lines, family] = await Promise.all([loadMapImageUrl(content), loadIsoImageUrl(content), loadTrails(), getHousehold()]);
        const season = await assignSeason(content, family.id);
        setState({ content, mapUrl, isoUrl, trails: buildTrailGraph(lines), season, familyId: family.id });
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    if (!state) return;
    let day = kstDate(new Date().toISOString());
    let active = true;
    const update = () => {
      const next = kstDate(new Date().toISOString());
      if (next === day) return;
      void assignSeason(state.content, state.familyId).then((season) => {
        if (!active) return;
        day = next;
        if (season.id !== state.season.id) setState({ ...state, season });
      }).catch(() => {});
    };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [state]);

  if (failed) {
    return (
      <main className="center-screen">
        <h1>처음 열 때는 인터넷이 필요해요</h1>
        <p>한 번 열고 나면 공원에서 연결이 끊겨도 쓸 수 있어요.</p>
        <button className="btn btn--primary" onClick={load}>
          다시 열기
        </button>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="center-screen" aria-busy="true">
        <p>지도를 펼치는 중이에요…</p>
      </main>
    );
  }
  return <ContentContext.Provider value={state}>{children}</ContentContext.Provider>;
}

export function useContent(): ContentState {
  const value = useContext(ContentContext);
  if (!value) throw new Error('ContentProvider 밖에서 useContent를 불렀어요');
  return value;
}
