import { CONTENT_URL } from '../config';
import { db } from '../data/db';
import type { TrailLine } from '../lib/trail';
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

const TRAILS_URL = '/map/trails.json';

/** 산책로 선(내 위치 설명·길 안내용). 기기에 사본을 두고, 끝내 못 받으면 빈 목록(직선 안내로 대신함). */
export async function loadTrails(): Promise<TrailLine[]> {
  const key = `trails:${TRAILS_URL}`;
  const parse = async (blob: Blob) => ((JSON.parse(await blob.text()) as { lines?: TrailLine[] }).lines ?? []);
  try {
    const res = await fetch(TRAILS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const lines = await parse(blob);
    db.assets.put({ key, blob }).catch(() => {});
    return lines;
  } catch {
    const cached = await db.assets.get(key).catch(() => undefined);
    return cached ? parse(cached.blob).catch(() => []) : [];
  }
}

/**
 * 그림 지도 이미지도 기기에 두고 object URL로 씁니다.
 * rev: 그림이 바뀌면 달라지는 값(scripts/build-map.mjs, build-iso.mjs). 바뀌면 그 그림의 옛 사본을 지우고 새로 받습니다.
 */
export async function loadImageUrl(image: string, rev: string | number): Promise<string> {
  const prefix = `img:${image}:`;
  const key = `${prefix}${rev}`;
  const cached = await db.assets.get(key).catch(() => undefined);
  if (cached) return URL.createObjectURL(cached.blob);
  try {
    const res = await fetch(image);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    await db.assets.where('key').startsWith(prefix).delete();
    await db.assets.where('key').startsWith('map:').delete(); // 옛 방식 사본
    await db.assets.put({ key, blob });
    return URL.createObjectURL(blob);
  } catch {
    return image;
  }
}

/** 위에서 본 지도(생물 위치 고르기·검토·처음 안내) */
export const loadMapImageUrl = (content: Content) => loadImageUrl(content.map.image, content.map.rev ?? content.version);

/** 지도 홈의 쿼터뷰 블록 지도. 콘텐츠에 없으면 null(위에서 본 지도로 대신함) */
export const loadIsoImageUrl = (content: Content) => (content.map.iso ? loadImageUrl(content.map.iso.image, content.map.iso.rev ?? content.version) : Promise.resolve(null));
