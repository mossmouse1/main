import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { buildTrailGraph, type TrailGraph } from '../lib/trail';
import { loadContent, loadIsoImageUrl, loadMapImageUrl, loadTrails } from './load';
import type { Content } from './types';

interface ContentState {
  content: Content;
  mapUrl: string;
  /** 지도 홈의 쿼터뷰 블록 지도(없으면 null) */
  isoUrl: string | null;
  /** 산책로 그래프(못 받았으면 점 0개) */
  trails: TrailGraph;
}

const ContentContext = createContext<ContentState | null>(null);

export function ContentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContentState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadContent()
      .then(async (content) => {
        const [mapUrl, isoUrl, lines] = await Promise.all([loadMapImageUrl(content), loadIsoImageUrl(content), loadTrails()]);
        setState({ content, mapUrl, isoUrl, trails: buildTrailGraph(lines) });
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

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
