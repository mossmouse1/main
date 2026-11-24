import type { Photo, Taxon } from '../content/types';
import { CategoryIcon } from './CategoryIcon';

/**
 * 종 사진. 이용 조건이 맞는 공개 참고 사진을 쓰고, 없으면 분류 아이콘을 씁니다.
 * 사진을 크게 보여 줄 때는 출처와 이용 조건을 같이 보여 줍니다.
 */
export function SpeciesArt({ taxon, photo, size = 'md', muted = false, showCredit = false, eager = false }: {
  taxon: Taxon;
  photo?: Photo | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'fill';
  muted?: boolean;
  showCredit?: boolean;
  eager?: boolean;
}) {
  const p = photo === undefined ? taxon.photo : photo;
  return (
    <figure className={`art art--${size} art--${taxon.category}${muted ? ' art--muted' : ''}`}>
      {p ? (
        <img src={p.src} alt={muted ? '' : taxon.koreanName} loading={eager ? 'eager' : 'lazy'} decoding="async" />
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
  const cc = photo.license.match(/^CC (BY(?:-SA)?) (\d+\.\d+)$/);
  const licenseUrl = cc ? `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/`
    : photo.license === 'CC0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : undefined;
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
      · {licenseUrl ? <a href={licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a> : photo.license}
    </figcaption>
  );
}
