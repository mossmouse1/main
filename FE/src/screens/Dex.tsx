import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { CategoryIcon } from '../components/CategoryIcon';
import { SearchOverlay } from '../components/SearchOverlay';
import { SpeciesArt } from '../components/SpeciesArt';
import { db, getMeta, setMeta } from '../data/db';
import { useDex, useSeason } from '../hooks';
import type { DexState } from '../lib/dex';
import { ClueCard, friendOf } from './Record';

type Kind = 'all' | 'animal' | 'plant';
const KIND_LABEL: Record<Kind, string> = { all: '전체', animal: '동물', plant: '식물' };

/** S8 나의 도감: 번호 칸 격자, 진행률, NEW, 다음 단서 */
export function Dex() {
  const dex = useDex();
  const season = useSeason();
  const [kind, setKind] = useState<Kind>('all');
  const [onlyUnfound, setOnlyUnfound] = useState(false);
  const [searching, setSearching] = useState(false);
  const latest = useRef<DexState | undefined>(undefined);
  latest.current = dex;

  // 도감을 보고 나가면 NEW와 ‘확인 후 바뀌었어요’ 표시를 거둡니다.
  useEffect(
    () => () => {
      const state = latest.current;
      if (!state) return;
      const filled = state.cells.filter((c) => c.filled).map((c) => c.taxon.id);
      void getMeta('dexSeen').then((seen) => setMeta('dexSeen', { ...seen, [season.id]: filled }));
      void db.observations.filter((o) => o.reviewChanged && !o.reviewSeen).modify({ reviewSeen: true });
    },
    [season.id],
  );

  if (!dex) return null;
  const newCount = dex.cells.filter((c) => c.isNew).length;
  const cells = dex.cells
    .map((cell, i) => ({ ...cell, no: i + 1 }))
    .filter((c) => (kind === 'animal' ? c.taxon.category !== 'tree' : kind === 'plant' ? c.taxon.category === 'tree' : true))
    .filter((c) => !onlyUnfound || !c.filled);

  return (
    <main className="page dex-page">
      <header className="dex-head">
        <div className="dex-head__row">
          <h1>나의 도감</h1>
          <div className="dex-head__tools">
            <Link to="/records" className="icon-btn" aria-label="내 기록">
              <Icon name="clipboard" size={24} />
            </Link>
            <button className="icon-btn" onClick={() => setSearching(true)} aria-label="생물 이름 찾기">
              <Icon name="search" size={24} />
            </button>
          </div>
        </div>
        <div className="dex-score" role="progressbar" aria-valuemin={0} aria-valuemax={dex.total} aria-valuenow={dex.filled} aria-label="발견한 생물">
          <p className="dex-score__num">
            <b>{dex.filled}</b>
            <span>/ {dex.total}</span>
          </p>
          <div className="dex-score__text">
            <span className="dex-score__season">{season.season} 도감</span>
            <span>{dex.filled === dex.total ? '모두 찾았어요!' : `${dex.total - dex.filled}종 더 찾으면 완성`}</span>
          </div>
          {newCount > 0 && <b className="dex-score__new">새로 찾음 +{newCount}</b>}
          {/* 칸 수만큼 작은 블록, 찾은 만큼 초록 */}
          <span className="dex-score__blocks" aria-hidden="true">
            {dex.cells.map((c) => (
              <i key={c.taxon.id} className={c.filled ? 'is-on' : undefined} />
            ))}
          </span>
        </div>
      </header>

      <div className="page__body stack">
        <div className="dex-filters">
          <div className="seg" role="group" aria-label="분류">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button key={k} className={kind === k ? 'is-on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button className={`toggle${onlyUnfound ? ' is-on' : ''}`} aria-pressed={onlyUnfound} onClick={() => setOnlyUnfound((v) => !v)}>
            <span className="toggle__box" aria-hidden="true">
              {onlyUnfound && <Icon name="check" size={13} />}
            </span>
            미발견만
          </button>
        </div>

        {dex.changedUnseen > 0 && (
          <p className="notice">
            <Icon name="shield" size={18} /> 팀이 사진을 확인하고 이름을 바꾼 기록이 있어요.
          </p>
        )}

        {cells.length === 0 ? (
          <p className="empty-line">{onlyUnfound ? '이 분류는 모두 찾았어요.' : '이 분류의 칸이 없어요.'}</p>
        ) : (
          <ul className="dex-grid">
            {cells.map((cell) => (
              <li key={cell.taxon.id}>
                <Link
                  to={`/species/${cell.taxon.id}`}
                  className={`dex-tile dex-tile--${cell.taxon.category}${cell.filled ? ' is-filled' : ''}${dex.nextClue?.id === cell.taxon.id ? ' is-next' : ''}`}
                  aria-label={cell.filled ? `${cell.no}번 ${cell.taxon.koreanName}, 찾음` : `${cell.no}번 아직 못 찾은 ${friendOf(cell.taxon)}`}
                >
                  <span className="dex-tile__no">No.{String(cell.no).padStart(3, '0')}</span>
                  {cell.isNew && <span className="new-tag">NEW</span>}
                  <span className="dex-tile__coin">
                    {cell.filled ? <SpeciesArt taxon={cell.taxon} size="fill" /> : <CategoryIcon category={cell.taxon.category} size={28} />}
                    {cell.filled && (
                      <span className="dex-tile__check">
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </span>
                  <span className="dex-tile__name">{cell.filled ? cell.taxon.koreanName : friendOf(cell.taxon)}</span>
                  {cell.changedByReview && <span className="changed-tag">확인 후 바뀜</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {dex.nextClue ? (
          <ClueCard taxon={dex.nextClue} />
        ) : (
          <p className="notice notice--ok">
            <Icon name="check" size={18} /> 이번 계절 칸을 모두 채웠어요. 계절이 바뀌면 새 칸이 열려요.
          </p>
        )}
      </div>
      {searching && <SearchOverlay onClose={() => setSearching(false)} />}
    </main>
  );
}
