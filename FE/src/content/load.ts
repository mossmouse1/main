import { CONTENT_URL } from '../config';
import { db } from '../data/db';
import type { Content } from './types';

let contentPromise: Promise<Content> | null = null;

/**
 * 콘텐츠(종 카드·계절 세트·구역·시설)를 한 번에 받습니다.
 * 서비스 워커가 없는 iOS 웹뷰에서도 다시 열 수 있게 받은 사본을 기기에 둡니다.
 */
export function loadContent(): Promise<Content> {
  contentPromise ??= (async () => {
    try {
      const res = await fetch(CONTENT_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`콘텐츠 ${res.status}`);
      const content = (await res.json()) as Content;
      db.meta.put({ key: 'content', value: content }).catch(() => {});
      return content;
    } catch (err) {
      const cached = await db.meta.get('content');
      if (cached) return cached.value as Content;
      contentPromise = null;
      throw err;
    }
  })();
  return contentPromise;
}

/** 그림 지도 이미지도 기기에 두고 object URL로 씁니다. */
export async function loadMapImageUrl(content: Content): Promise<string> {
  const key = `map:${content.version}:${content.map.image}`;
  const cached = await db.assets.get(key);
  if (cached) return URL.createObjectURL(cached.blob);
  try {
    const res = await fetch(content.map.image);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    await db.assets.where('key').startsWith('map:').delete();
    await db.assets.put({ key, blob });
    return URL.createObjectURL(blob);
  } catch {
    return content.map.image;
  }
}
