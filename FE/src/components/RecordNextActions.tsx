import { Link } from 'react-router';
import { questMapUrl, type DexState } from '../lib/dex';
import { Icon } from './Icon';

export function RecordNextActions({ dex, newTaxonId }: { dex?: DexState; newTaxonId?: string }) {
  const complete = !!dex?.completion;
  return (
    <section className="record-next card" aria-label="저장 후 이어서 하기">
      <div className="record-next__summary">
        <div>
          <p className="caption">
            계절 퀘스트{dex && dex.total > 0 && <> · {dex.filled}/{dex.total}종</>}
          </p>
          <h2>{complete ? '계절 퀘스트를 완료했어요!' : '탐험을 이어가요'}</h2>
        </div>
      </div>
      {dex && dex.total > 0 && (
        <ol className="record-next__cells" role="list" aria-label="퀘스트 도감 칸">
          {dex.cells.map(({ taxon, filled }) => (
            <li key={taxon.id} className={`${filled ? 'is-filled' : ''}${filled && taxon.id === newTaxonId ? ' is-new' : ''}`}
              aria-label={`${taxon.koreanName}, ${filled ? '찾았어요' : '아직 못 찾았어요'}`}>
              {filled && <Icon name="check" size={13} />}
            </li>
          ))}
        </ol>
      )}
      {complete && <p className="caption">모은 사진 10장으로 만든 완료 이미지를 현장 운영진에게 보여 주면 리워드를 받을 수 있어요.</p>}
      <Link replace to={complete ? '/dex/complete' : '/record/photo'} className="btn btn--primary btn--block">
        <Icon name={complete ? 'check' : 'camera'} size={20} />
        {complete ? '완료 사진 보기' : '다른 생물 촬영하기'}
      </Link>
      <div className="record-next__links">
        <Link replace to={questMapUrl()}>퀘스트 지도</Link>
        <Link replace to="/dex?view=collection">전체 도감</Link>
      </div>
    </section>
  );
}
