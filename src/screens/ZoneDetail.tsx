import { Link, Navigate, useParams } from 'react-router';
import { PageHeader } from '../components/Layout';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { zoneById } from '../content/helpers';
import { CATEGORY_LABEL } from '../content/types';
import { useDex, useSeason } from '../hooks';

/** S2 구역 상세: 구역 설명, 이 구역에서 찾아볼 후보와 공개 기록 수 */
export function ZoneDetail() {
  const { id } = useParams();
  const { content } = useContent();
  const season = useSeason();
  const dex = useDex();
  const zone = zoneById(content, id);
  if (!zone) return <Navigate to="/" replace />;

  const taxa = content.taxa
    .filter((t) => !t.minor && t.clue.zoneIds.includes(zone.id))
    .sort((a, b) => (season.recordCounts[b.id] ?? 0) - (season.recordCounts[a.id] ?? 0));

  return (
    <main className="page">
      <PageHeader title={zone.name} />
      <div className="page__body stack">
        <p className="lead">{zone.description}</p>
        <dl className="facts">
          <dt>어디</dt>
          <dd>{zone.places}</dd>
          <dt>먼저 볼 것</dt>
          <dd>{zone.lookFor}</dd>
          <dt>남기면 좋은 것</dt>
          <dd>{zone.leave}</dd>
        </dl>
        {zone.placeholder && <p className="caption">구역 경계는 임시예요. 사전답사 뒤 바뀌어요.</p>}

        <h2>이 구역에서 찾아볼 후보</h2>
        <ul className="species-list">
          {taxa.map((t) => (
            <li key={t.id}>
              <Link to={`/species/${t.id}`} className="species-row">
                <SpeciesArt taxon={t} size="sm" />
                <span className="species-row__text">
                  <strong>{t.koreanName}</strong>
                  <span className="muted">
                    {CATEGORY_LABEL[t.category]} · 공개 기록 {season.recordCounts[t.id] ?? '–'}건
                  </span>
                </span>
                {dex?.foundIds.has(t.id) && <span className="badge badge--ok">찾음</span>}
              </Link>
            </li>
          ))}
        </ul>
        <p className="caption">공개 기록 수 기준: {season.recordCountsBasis}</p>
      </div>
    </main>
  );
}
