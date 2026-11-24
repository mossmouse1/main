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
  const fieldCounts = new Map<string, number>();
  for (const photo of content.fieldPhotos ?? []) {
    if (photo.taxonId) fieldCounts.set(photo.taxonId, (fieldCounts.get(photo.taxonId) ?? 0) + 1);
  }
  const hasRecords = (taxon: typeof content.taxa[number]) => taxon.publicObservations?.length || fieldCounts.has(taxon.id);
  const recorded = content.taxa.filter(hasRecords);
  const taxa = (query.trim() ? searchTaxa(content, query, content.taxa.length) : recorded)
    .filter(hasRecords)
    .sort((a, b) => a.koreanName.localeCompare(b.koreanName, 'ko'));

  return (
    <main className="page">
      <PageHeader title="공개 관찰 기록" backTo="/?public=1" />
      <div className="page__body stack">
        <p>{content.park.name} · {recorded.length}종</p>
        <p className="caption">좌표가 있으면 관찰 지점으로, 장소만 알려진 자료는 구역 기록으로 표시해요.</p>
        <Link to="/?public=1" className="btn btn--primary btn--block">
          <Icon name="map" size={20} /> 전체 기록 지도에서 보기
        </Link>
        <input className="public-record-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="관찰된 생물 검색" placeholder="이름이나 학명 검색" />
        {taxa.length === 0 && <p className="muted">볼 수 있는 기록이 없어요.</p>}
        <ul className="alt-list">
          {taxa.map((taxon) => {
            const observations = taxon.publicObservations ?? [];
            const field = fieldCounts.get(taxon.id);
            const points = observations.filter((record) => 'lat' in record).length;
            const areas = observations.length - points;
            return (
              <li key={taxon.id}>
                <Link className="alt" to={`/species/${taxon.id}`}>
                  <SpeciesArt taxon={taxon} size="sm" />
                  <span>
                    <strong>{taxon.koreanName}</strong>
                    <span className="muted">{[points && `좌표 기록 ${points}건`, areas && `구역 기록 ${areas}건`, field && `현장 사진 ${field}장`].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {content.publicObservationsUpdatedOn && <p className="caption">자료 갱신 {content.publicObservationsUpdatedOn}</p>}
      </div>
    </main>
  );
}
