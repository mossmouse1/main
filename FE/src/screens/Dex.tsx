import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { SearchOverlay } from '../components/SearchOverlay';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { searchTaxa } from '../content/helpers';
import { db, getMeta, setMeta } from '../data/db';
import { useDex, useSeason } from '../hooks';
import { questMapUrl, type DexState } from '../lib/dex';

type Kind = 'all' | 'animal' | 'plant';
const KIND_LABEL: Record<Kind, string> = { all: '전체', animal: '동물', plant: '식물' };

/** S8 나의 도감: 번호 칸 격자, 진행률, NEW */
export function Dex() {
  const dex = useDex();
  const season = useSeason();
  const { content } = useContent();
  const [params, setParams] = useSearchParams();
  const collection = params.get('view') === 'collection';
  const query = params.get('q') ?? '';
  const filter = params.get('kind');
  const kind: Kind = filter === 'animal' || filter === 'plant' ? filter : 'all';
  const limit = Math.max(30, Number(params.get('limit')) || 0);
  const onlyUnfound = params.get('unfound') === '1';
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
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'limit') next.delete('limit');
    setParams(next, { replace: true });
  };
  const newCount = dex.cells.filter((c) => c.isNew).length;
  const allCells = collection ? (query.trim() ? searchTaxa(content, query, content.taxa.length) : content.taxa)
    .map((taxon) => ({ taxon, filled: dex.collectionFoundIds.has(taxon.id), isNew: false, changedByReview: false }))
    .sort((a, b) => Number(b.filled) - Number(a.filled) || a.taxon.koreanName.localeCompare(b.taxon.koreanName, 'ko'))
    : dex.cells;
  const cells = allCells
    .map((cell, i) => ({ ...cell, no: i + 1 }))
    .filter(({ taxon }) => kind === 'all' || (kind === 'plant') === (taxon.isPlant || taxon.category === 'tree'))
    .filter((c) => !onlyUnfound || !c.filled);

  return (
    <main className="page dex-page">
      <header className="dex-head">
        <div className="dex-head__row">
          <h1>{collection ? '전체 도감' : '나의 도감'}</h1>
          <div className="dex-head__tools">
            <Link to="/records" className="icon-btn" aria-label="내 기록">
              <Icon name="clipboard" size={24} />
            </Link>
            <button className="icon-btn" onClick={() => setSearching(true)} aria-label="생물 이름 찾기">
              <Icon name="search" size={24} />
            </button>
          </div>
        </div>
        {!collection && <div className="dex-score" role="progressbar" aria-valuemin={0} aria-valuemax={dex.total} aria-valuenow={dex.filled} aria-label="발견한 생물">
          <p className="dex-score__num">
            <b>{dex.filled}</b>
            <span>/ {dex.total}</span>
          </p>
          <div className="dex-score__text">
            <span className="dex-score__season">{season.season} 퀘스트</span>
            <span>{dex.filled === dex.total ? '모두 찾았어요!' : `${dex.total - dex.filled}종 더 찾으면 완성`}</span>
          </div>
          {newCount > 0 && <b className="dex-score__new">새로 찾음 +{newCount}</b>}
          {/* 칸 수만큼 작은 블록, 찾은 만큼 초록 */}
          <span className="dex-score__blocks" aria-hidden="true">
            {dex.cells.map((c) => (
              <i key={c.taxon.id} className={c.filled ? 'is-on' : undefined} />
            ))}
          </span>
        </div>}
      </header>

      <div className="page__body stack">
        <div className="seg" role="group" aria-label="도감 보기">
          <button className={!collection ? 'is-on' : ''} aria-pressed={!collection} onClick={() => setParams({})}>계절 퀘스트</button>
          <button className={collection ? 'is-on' : ''} aria-pressed={collection} onClick={() => setParams({ view: 'collection' })}>전체 도감</button>
        </div>
        {collection ? (
          <>
            <p>전체 {content.taxa.length}종 · 내가 기록한 생물 {dex.collectionFoundIds.size}종</p>
            <Link className="btn btn--secondary btn--block" to="/dex/field">조사팀 현장 사진</Link>
            <input className="public-record-search" type="search" aria-label="전체 도감에서 이름 찾기" placeholder="생물 이름이나 학명" value={query} onChange={(event) => updateFilter('q', event.target.value)} />
          </>
        ) : dex.completion ? (
          <Link className="btn btn--primary btn--block" to="/dex/complete">
            <Icon name="check" size={20} /> 퀘스트 완료 사진 보기
          </Link>
        ) : (
          <>
            <p className="caption">이번 계절에 찾아볼 수 있는 후보 중 원하는 생물부터 찍어요.</p>
            <Link className="btn btn--secondary btn--block" to={questMapUrl()}><Icon name="map" size={20} /> 지도에서 주변 후보 보기</Link>
          </>
        )}
        {!collection && <p className="caption">
          {season.recordCountsBasis}를 바탕으로 이번 계절의 식물 8종과 물새 2종을 골랐어요.
        </p>}
        <div className="dex-filters">
          <div className="seg" role="group" aria-label="분류">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button key={k} className={kind === k ? 'is-on' : ''} aria-pressed={kind === k} onClick={() => updateFilter('kind', k === 'all' ? '' : k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button className={`toggle${onlyUnfound ? ' is-on' : ''}`} aria-pressed={onlyUnfound} onClick={() => updateFilter('unfound', onlyUnfound ? '' : '1')}>
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
            {(collection ? cells.slice(0, limit) : cells).map((cell, index) => (
              <li key={cell.taxon.id}>
                <Link
                  to={`/species/${cell.taxon.id}`}
                  className={`dex-tile dex-tile--${cell.taxon.category}${cell.filled ? ' is-filled' : ''}`}
                  aria-label={`${cell.taxon.koreanName}, ${cell.filled ? '찾음' : '미발견'}`}
                >
                  <span className="dex-tile__no">No.{String(cell.no).padStart(3, '0')}</span>
                  {cell.isNew && <span className="new-tag">NEW</span>}
                  <span className="dex-tile__coin">
                    <SpeciesArt taxon={cell.taxon} size="fill" eager={index < 9} />
                    {cell.filled && (
                      <span className="dex-tile__check">
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </span>
                  <span className="dex-tile__name">{cell.taxon.koreanName}</span>
                  {cell.changedByReview && <span className="changed-tag">확인 후 바뀜</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {collection && cells.length > limit && <button className="btn btn--secondary btn--block" onClick={() => updateFilter('limit', String(limit + 30))}>더 보기</button>}
        {collection && dex.unnamed.length > 0 && (
          <section className="sec">
            <h2 className="sec__title">이름 확인을 기다리는 내 사진</h2>
            <ul className="rows">
              {dex.unnamed.map((entry) => (
                <li key={entry.id}><Link to={`/records?focus=${entry.id}`}>{entry.name || '미확인 생물'} · {entry.observedAt.slice(0, 10)}</Link></li>
              ))}
            </ul>
          </section>
        )}
        {!collection && dex.completion && (
          <p className="notice notice--ok">
            <Icon name="check" size={18} /> 이번 계절 칸을 모두 채웠어요. 계절이 바뀌면 새 칸이 열려요.
          </p>
        )}
      </div>
      {searching && <SearchOverlay onClose={() => setSearching(false)} />}
    </main>
  );
}
