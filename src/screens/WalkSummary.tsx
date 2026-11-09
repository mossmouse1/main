import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { taxonById } from '../content/helpers';
import type { Taxon } from '../content/types';
import { db } from '../data/db';
import { useDex } from '../hooks';
import { formatDate, formatDuration, minutesBetween } from '../lib/time';
import { NextClue } from './Record';

/** S10 오늘의 탐험: 탐험 시간, 찾은 종, 다음에 찾을 단서 */
export function WalkSummary() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const { content } = useContent();
  const dex = useDex();
  const walk = useLiveQuery(async () => {
    if (id) return (await db.walks.get(id)) ?? null;
    const ended = (await db.walks.orderBy('startedAt').reverse().toArray()).find((w) => w.endedAt);
    return ended ?? null;
  }, [id]);
  const observations = useLiveQuery(async () => (walk ? db.observations.where('walkId').equals(walk.id).toArray() : []), [walk?.id], []);

  useEffect(() => {
    if (walk && walk.endedAt && !walk.summarySeen) void db.walks.update(walk.id, { summarySeen: true });
  }, [walk]);

  if (walk === undefined) return null;
  if (walk === null) {
    return (
      <main className="page">
        <PageHeader title="오늘의 탐험" />
        <div className="page__body">
          <div className="empty">
            <h2>아직 끝난 탐험이 없어요</h2>
            <p className="muted">지도에서 ‘탐험 시작’을 누르거나 첫 기록을 남기면 탐험이 시작돼요. 끝나면 여기에서 오늘 찾은 종과 시간을 볼 수 있어요.</p>
            <Link to="/" className="btn btn--primary">
              <Icon name="explore" size={20} /> 탐험하러 가기
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const minutes = minutesBetween(walk.startedAt, walk.endedAt ?? new Date().toISOString());
  const found = [...new Set(observations.filter((o) => !o.hidden).map((o) => o.taxonId))]
    .map((tid) => taxonById(content, tid))
    .filter((t): t is Taxon => !!t);

  return (
    <main className="page">
      <PageHeader title="오늘의 탐험" />
      <div className="page__body stack">
        <p className="muted">
          {formatDate(walk.startedAt)}
          {walk.endedBy === 'auto' && (
            <span className="badge">
              <Icon name="clock" size={16} /> 자동 종료
            </span>
          )}
          {!walk.endedAt && <span className="badge badge--wait">탐험 중</span>}
        </p>
        <div className="stats">
          <div>
            <strong>{formatDuration(minutes)}</strong>
            <span>탐험 시간</span>
          </div>
          <div>
            <strong>{found.length}종</strong>
            <span>찾은 종</span>
          </div>
          <div>
            <strong>{observations.length}건</strong>
            <span>남긴 기록</span>
          </div>
        </div>

        {found.length > 0 ? (
          <ul className="found-list">
            {found.map((t) => (
              <li key={t.id}>
                <Link to={`/species/${t.id}`}>
                  <SpeciesArt taxon={t} size="sm" />
                  <span>{t.koreanName}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lead">이번에는 이름을 고른 기록이 없어요. 팀이 사진을 확인해 줄 거예요.</p>
        )}

        {walk.effortText && <p className="caption">조사 노력: {walk.effortText}</p>}
        {dex?.nextClue && (
          <>
            <h2>다음에 찾을 단서</h2>
            <NextClue taxonId={dex.nextClue.id} />
          </>
        )}
        <div className="row">
          <Link to="/dex" className="btn btn--secondary">
            도감 보기
          </Link>
          <Link to="/" className="btn btn--primary">
            지도로
          </Link>
        </div>
      </div>
    </main>
  );
}
