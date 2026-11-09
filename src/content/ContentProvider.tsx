import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadContent, loadMapImageUrl } from './load';
import type { Content } from './types';

interface ContentState {
  content: Content;
  mapUrl: string;
}

const ContentContext = createContext<ContentState | null>(null);

export function ContentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContentState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadContent()
      .then(async (content) => setState({ content, mapUrl: await loadMapImageUrl(content) }))
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
