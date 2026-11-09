import type { Photo, Taxon } from '../content/types';
import { CategoryIcon } from './CategoryIcon';

/**
 * 종 사진. 이용 조건이 맞는 공개 사진(위키미디어 커먼즈)을 쓰고, 없으면 분류 아이콘을 씁니다.
 * 사진을 크게 보여 줄 때는 출처와 이용 조건을 같이 보여 줍니다.
 */
export function SpeciesArt({ taxon, photo, size = 'md', muted = false, showCredit = false }: {
  taxon: Taxon;
  photo?: Photo | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'fill';
  muted?: boolean;
  showCredit?: boolean;
}) {
  const p = photo === undefined ? taxon.photo : photo;
  return (
    <figure className={`art art--${size} art--${taxon.category}${muted ? ' art--muted' : ''}`}>
      {p ? (
        <img src={p.src} alt={muted ? '' : taxon.koreanName} loading="lazy" decoding="async" />
      ) : (
        <span className="art__icon">
          <CategoryIcon category={taxon.category} size={size === 'lg' ? 64 : size === 'xs' ? 18 : 30} />
        </span>
      )}
      {showCredit && p && <PhotoCredit photo={p} />}
    </figure>
  );
}

export function PhotoCredit({ photo }: { photo: Photo }) {
  return (
    <figcaption className="credit">
      사진{' '}
      {photo.sourceUrl ? (
        <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
          {photo.credit}
        </a>
      ) : (
        photo.credit
      )}{' '}
      · {photo.license}
    </figcaption>
  );
}
