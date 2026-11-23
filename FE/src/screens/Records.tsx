import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router';
import { IdStatusBadge, SyncBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { BlobImage, PageHeader, Toast } from '../components/Layout';
import { RecordReward, useRecordReward } from '../components/RecordReward';
import { useContent } from '../content/ContentProvider';
import { taxonById, zoneById } from '../content/helpers';
import { db } from '../data/db';
import { retryNow } from '../data/sync';
import type { LocalObservation, LocalWalk } from '../data/types';
import { useOnline, usePendingCount } from '../hooks';
import { formatDate, formatTime } from '../lib/time';

/** S9 우리 기록: 기록 목록, 검토 상태, 전송 대기 표시 */
export function Records() {
  const { content } = useContent();
  const pending = usePendingCount();
  const online = useOnline();
  const observations = useLiveQuery(() => db.observations.orderBy('createdAt').reverse().toArray(), [], []);
  const walks = useLiveQuery(() => db.walks.toArray(), [], []);
  const failing = useLiveQuery(() => db.outbox.filter((o) => !!o.lastError && o.kind !== 'events').count(), [], 0);
  const lastError = useLiveQuery(() => db.outbox.filter((o) => !!o.lastError && o.kind !== 'events').last(), []);

  const [params] = useSearchParams();
  const saved = observations.find((o) => o.id === params.get('saved'));
  const reward = useRecordReward(saved?.id);
  const savedToast = saved && (
    <Toast tone="soft">
      <Icon name="bookmark" size={20} />
      <span>
        {saved.taxonId ? '기록했어요!' : '미확인 기록으로 저장했어요.'}
        <small>{saved.taxonId ? '도감에서 확인해 보세요.' : '팀이 사진을 보고 이름을 확인해 줄 거예요.'}</small>
      </span>
    </Toast>
  );
  const walkById = new Map(walks.map((w) => [w.id, w]));
  const groups: { walkId: string; items: LocalObservation[] }[] = [];
  for (const o of observations) {
    const g = groups.find((x) => x.walkId === o.walkId);
    if (g) g.items.push(o);
    else groups.push({ walkId: o.walkId, items: [o] });
  }

  return (
    <main className="page">
      <PageHeader
        title="내 기록"
        backTo="/dex"
        right={
          <Link to="/settings" className="icon-btn" aria-label="설정">
            <Icon name="gear" size={26} />
          </Link>
        }
      />
      <div className="page__body stack">
        {observations.length > 0 && (
          <dl className="tally">
            <div>
              <dt>기록</dt>
              <dd>{observations.filter((o) => !o.hidden).length}</dd>
            </div>
            <div>
              <dt>찾은 종</dt>
              <dd>{new Set(observations.filter((o) => !o.hidden && o.taxonId).map((o) => o.taxonId)).size}</dd>
            </div>
            <div>
              <dt>탐험</dt>
              <dd>{walks.length}</dd>
            </div>
          </dl>
        )}
        {savedToast && <RecordReward active={reward} stamp="기록" compact>{savedToast}</RecordReward>}
        {pending > 0 && (
          <div className="card row row--between">
            <span>
              <Icon name="clock" size={20} /> 전송 대기 {pending}건
              {!online && <span className="muted"> · 연결되면 자동으로 보내요</span>}
            </span>
            {online && (
              <button className="btn btn--secondary btn--small" onClick={() => void retryNow()}>
                지금 보내기
              </button>
            )}
          </div>
        )}
        {failing > 0 && lastError?.lastError && (
          <p className="caption">
            다시 보내는 중: {lastError.lastError} (기록은 휴대폰에 안전하게 있어요)
          </p>
        )}

        {groups.length === 0 && (
          <div className="empty">
            <h2>아직 기록이 없어요</h2>
            <p className="muted">공원에서 오늘의 6종을 찾아 사진으로 남겨 보세요.</p>
            <Link to="/" className="btn btn--primary">
              <Icon name="explore" size={20} /> 오늘의 6종 보러 가기
            </Link>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.walkId} className="stack stack--tight">
            <WalkHeader walk={walkById.get(g.walkId)} fallbackDate={g.items[g.items.length - 1].observedAt} />
            <ul className="record-list">
              {g.items.map((o) => {
                const taxon = taxonById(content, o.taxonId);
                return (
                  <li key={o.id} className={`record-item${o.hidden ? ' is-hidden' : ''}${o.id === saved?.id ? ' is-saved' : ''}`}>
                    <RecordThumb photoId={o.photoIds[0]} />
                    <div className="record-item__body">
                      <strong>{taxon?.koreanName ?? (o.pickSource === 'unknown' ? '미확인 생물' : o.freeTextName ? `‘${o.freeTextName}’` : '이름 모름')}</strong>
                      {!taxon && o.pickSource === 'unknown' && o.freeTextName && <span className="record-item__memo">메모: {o.freeTextName}</span>}
                      <span className="muted">
                        {formatTime(o.observedAt)} · {o.outsidePark ? '공원 밖' : (zoneById(content, o.zoneId)?.name ?? '조사구역 밖')}
                      </span>
                      <span className="row row--wrap row--tight">
                        <IdStatusBadge status={o.idStatus} />
                        <SyncBadge sync={o.sync} />
                        {o.reviewChanged && <span className="changed-tag">확인 후 바뀌었어요</span>}
                        {o.hidden && <span className="badge">팀이 숨긴 기록</span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function WalkHeader({ walk, fallbackDate }: { walk: LocalWalk | undefined; fallbackDate: string }) {
  if (!walk) return <h2 className="walk-head">{formatDate(fallbackDate)}</h2>;
  return (
    <h2 className="walk-head">
      <Link to={`/walk/summary?id=${walk.id}`}>
        {formatDate(walk.startedAt)}
        <span className="muted">
          {walk.endedAt ? ` · ${walk.effortText ?? ''}${walk.endedBy === 'auto' ? ' · 자동 종료' : ''}` : ' · 탐험 중'}
        </span>
      </Link>
    </h2>
  );
}

function RecordThumb({ photoId }: { photoId: string | undefined }) {
  const photo = useLiveQuery(async () => (photoId ? db.photos.get(photoId) : undefined), [photoId]);
  return <BlobImage blob={photo?.display ?? null} alt="기록 사진" className="record-item__thumb" />;
}
