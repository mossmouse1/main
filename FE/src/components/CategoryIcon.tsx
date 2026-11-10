import type { Category } from '../content/types';

/** 분류 아이콘(흰 실루엣). 지도 핀·칩·사진이 없을 때 씁니다. */
export const CATEGORY_ICON_PATH: Record<Category, string> = {
  waterbird: 'M7 15.5c0-3 2.6-5 6-5 .4-2.3 2-3.5 3.8-3.5 1.4 0 2.3.7 2.7 1.6l2 .6-2 .8c0 1.5-.8 2.6-2 3.2 1.1.8 1.5 1.9 1.5 2.8 0 2-2.3 3.5-6 3.5-3.4 0-6-1.6-6-4zM3 20.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0',
  townbird: 'M5 13c0-3.5 3-5.5 6.5-5.5.6-1.8 2-2.5 3.5-2.5 1.6 0 2.7 1 3 2.2l2 .8-2 .6c-.2 2.7-1.6 4.3-3.6 5.4L19 19h-2.5l-3-3.6c-1 .3-2.3.4-3.6.2L5.5 19H3.5l3.8-4.4C5.9 14.3 5 13.7 5 13z',
  tree: 'M12 2.5c3.6 0 6.5 2.8 6.5 6.3 0 2.5-1.4 4.6-3.5 5.6H13v7h-2v-7H9c-2.1-1-3.5-3.1-3.5-5.6C5.5 5.3 8.4 2.5 12 2.5zM9.5 8.3a1.3 1.3 0 1 0 0 .1zm5 1.7a1.3 1.3 0 1 0 0 .1zm-2.5-4a1.2 1.2 0 1 0 0 .1z',
  other: 'M19.5 4.5C12 4.5 6 8.6 6 14.6c0 1.5.4 2.8 1 3.9L4.5 21l1.4 1.4 2.4-2.4c1 .6 2.3 1 3.7 1 5.8 0 8-6.4 7.5-16.5zM9.4 17.8l6-6',
};

export function CategoryIcon({ category, size = 20 }: { category: Category; size?: number }) {
  const stroked = category === 'waterbird' || category === 'other';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={CATEGORY_ICON_PATH[category]}
        fill="currentColor"
        stroke={stroked ? 'currentColor' : 'none'}
        strokeWidth={stroked ? 1.2 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
        fillRule="evenodd"
      />
    </svg>
  );
}

/** Leaflet divIcon 안에 넣을 문자열 버전 */
export function categoryIconSvg(category: Category, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${CATEGORY_ICON_PATH[category]}" fill="currentColor" stroke="currentColor" stroke-width="${category === 'waterbird' || category === 'other' ? 1.2 : 0}" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd"/></svg>`;
}
