import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { searchTaxa } from '../content/helpers';

export function PublicObservations() {
  const { content } = useContent();
  const [query, setQuery] = useState('');
  const fieldTaxa = new Set((content.fieldPhotos ?? []).map((photo) => photo.taxonId));
  const taxa = (query.trim() ? searchTaxa(content, query, content.taxa.length) : content.taxa)
    .filter((taxon) => taxon.publicObservations?.length || fieldTaxa.has(taxon.id))
    .sort((a, b) => a.koreanName.localeCompare(b.koreanName, 'ko'));

  return (
    <main className="page">
      <PageHeader title="관찰 종 목록" backTo="/?public=1" />
      <div className="page__body stack">
        <Link to="/?public=1" className="btn btn--primary btn--block">
          <Icon name="map" size={20} /> 지도 보기
        </Link>
        <input className="public-record-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="관찰된 생물 검색" placeholder="이름이나 학명 검색" />
        {taxa.length === 0 && <p className="muted">볼 수 있는 기록이 없어요.</p>}
        <ul className="alt-list">
          {taxa.map((taxon) => (
            <li key={taxon.id}>
              <Link className="alt" to={`/species/${taxon.id}`}>
                <SpeciesArt taxon={taxon} size="sm" />
                <span>
                  <strong>{taxon.koreanName}</strong>
                  {taxon.scientificName && <span className="muted">{taxon.scientificName}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
