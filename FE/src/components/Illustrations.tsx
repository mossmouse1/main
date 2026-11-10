import type { Category } from '../content/types';
import { CategoryIcon } from './CategoryIcon';

/** 로고: 숲색 바탕에 잎 두 장과 물결 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#1E4631" />
      <path d="M15.6 23.2C10.4 22 8 17.8 9.2 11.4c6 .5 9.2 4.2 6.4 11.8Z" fill="#B9D59A" />
      <path d="M16.4 23.2c-.7-6.4 2-11.2 7.8-13.1.9 6.8-2.2 11.6-7.8 13.1Z" fill="#FFFFFF" />
      <path d="M8 26.4c1.3.8 2.7.8 4 0s2.7-.8 4 0 2.7.8 4 0 2.7-.8 4 0" fill="none" stroke="#86B9AE" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 지도 나침반(누르면 처음 보던 곳으로) */
export function Compass({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <text x="13" y="7.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor">
        N
      </text>
      <path d="M13 9.5 16 17h-6Z" fill="#C8462B" />
      <path d="M13 24.5 10 17h6Z" fill="#B8BDB4" />
    </svg>
  );
}

/** 못 찾은 칸: 분류 실루엣 */
export function Silhouette({ category, size = 48 }: { category: Category; size?: number }) {
  return (
    <span className="sil" aria-hidden="true">
      <CategoryIcon category={category} size={size} />
    </span>
  );
}

/** 발견 도장(생물 카드): 처음 찾은 날(한국 시간) */
export function FoundStamp({ date }: { date?: string | null }) {
  const d = date ? new Date(Date.parse(date) + 9 * 3600_000) : null;
  const mm = d ? String(d.getUTCMonth() + 1).padStart(2, '0') : '';
  const dd = d ? String(d.getUTCDate()).padStart(2, '0') : '';
  return (
    <span className="stamp" role="img" aria-label={d ? `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 발견` : '발견'}>
      <b>발견</b>
      {d && (
        <small>
          {mm}.{dd}
        </small>
      )}
    </span>
  );
}
