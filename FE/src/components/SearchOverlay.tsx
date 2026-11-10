import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useContent } from '../content/ContentProvider';
import { searchTaxa } from '../content/helpers';
import { CATEGORY_LABEL } from '../content/types';
import { Icon } from './Icon';
import { SpeciesArt } from './SpeciesArt';

/** 생물 이름 찾기(지도 위 검색). 공원 주변 공개 기록에 나온 종까지 찾습니다. */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { content } = useContent();
  const [query, setQuery] = useState('');
  const results = query.trim() ? searchTaxa(content, query) : content.taxa.filter((t) => !t.minor).slice(0, 12);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="생물 이름 찾기">
      <div className="search-overlay__bar">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="생물 이름 (예: 물닭, 박새)"
          autoFocus
          enterKeyHint="search"
        />
        <button className="btn btn--ghost btn--small" onClick={onClose}>
          닫기
        </button>
      </div>
      <ul className="search-list">
        {results.map((t) => (
          <li key={t.id}>
            <Link to={`/species/${t.id}`} className="species-row">
              <SpeciesArt taxon={t} size="xs" />
              <span className="species-row__text">
                <strong>{t.koreanName}</strong>
                <span className="muted">
                  {CATEGORY_LABEL[t.category]}
                  {t.recordCount ? ` · 주변 기록 ${t.recordCount}건` : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {query.trim() && results.length === 0 && <li className="muted">이 공원 주변 기록에는 없는 이름이에요.</li>}
      </ul>
    </div>
  );
}
