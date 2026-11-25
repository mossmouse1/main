import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { IdStatusBadge, SyncBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { FoundStamp } from '../components/Illustrations';
import { BlobImage, PageHeader, Toast } from '../components/Layout';
import { MonthBars } from '../components/MonthBars';
import { RecordNextActions } from '../components/RecordNextActions';
import { RecordReward, useRecordReward } from '../components/RecordReward';
import { PhotoCredit, SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { taxonById, zoneById } from '../content/helpers';
import { CATEGORY_LABEL } from '../content/types';
import { db } from '../data/db';
import { startDraft } from '../data/draft';
import { useDex, useSeason } from '../hooks';
import { questMapUrl } from '../lib/dex';
import { formatDate, formatTime } from '../lib/time';

/** S3 생물 카드(생물 도감): 사진, 알아보는 법, 만나는 곳, 우리 가족 기록, 월별 기록, 헷갈리는 종. 저장 직후에는 ‘새로운 발견!’ */
export function SpeciesCard() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const savedId = params.get('saved');
  const { content } = useContent();
  const season = useSeason();
  const dex = useDex();
  const navigate = useNavigate();
  const taxon = taxonById(content, id);
  const [hero, setHero] = useState<'mine' | number>(() => params.get('photo') === 'reference' ? 0 : 'mine');

  const mine = useLiveQuery(
    async () => {
      if (!id) return [];
      const list = (await db.observations.where('taxonId').equals(id).toArray()).filter((o) => !o.hidden).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      const photos = await Promise.all(list.map((o) => (o.photoIds[0] ? db.photos.get(o.photoIds[0]) : undefined)));
      return list.map((obs, i) => ({ obs, photo: photos[i] }));
    },
    [id],
    [],
  );

  const saved = savedId ? mine.find((m) => m.obs.id === savedId) : undefined;
  const reward = useRecordReward(saved?.obs.id);
  if (!taxon) return <Navigate to="/" replace />;
  const found = !!dex?.collectionFoundIds.has(taxon.id);
  const refs = taxon.photos?.length ? taxon.photos : taxon.photo ? [taxon.photo] : [];
  const myPhoto = saved?.photo ?? mine.find((m) => m.photo)?.photo;
  const showMine = hero === 'mine' && !!myPhoto;
  const refPhoto = refs[typeof hero === 'number' ? hero : 0] ?? null;
  const zone = zoneById(content, taxon.clue.zoneIds[0]);
  const dexIndex = season.dex.indexOf(taxon.id);
  const firstSeen = mine.length ? mine[mine.length - 1].obs.observedAt : null;
  const photoCount = mine.reduce((n, m) => n + m.obs.photoIds.length, 0);
  const fieldPhotos = (content.fieldPhotos ?? []).filter((photo) => photo.taxonId === taxon.id);

  const onShoot = async () => {
    await startDraft(taxon.id);
    navigate('/record/photo');
  };

  const heroCard = (
    <div className={`species-hero${!showMine && refPhoto ? ' species-hero--reference' : ''}${saved ? ' species-hero--saved' : ''}`}>
      {showMine ? (
        <BlobImage blob={myPhoto.display ?? myPhoto.original} alt={`우리가 찍은 ${taxon.koreanName}`} className="species-hero__img" />
      ) : (
        <SpeciesArt taxon={taxon} photo={refPhoto} size="fill" />
      )}
      {(showMine || refPhoto) && <span className="species-hero__badge">{showMine ? '내가 찍은 사진' : '참고 사진'}</span>}
      {saved && (
        <Toast>
          <Icon name="check" size={20} />
          {reward ? (
            <>
              {reward === 'completion' ? '계절 도감 완성!' : '새로운 발견!'} <b className="toast__plus">+1</b>
            </>
          ) : (
            <>내 기록에 저장했어요</>
          )}
        </Toast>
      )}
    </div>
  );
  return (
    <main className="page species-page">
      <PageHeader title={saved ? `${taxon.koreanName} 기록` : '생물 도감'} returnTo={saved ? questMapUrl() : undefined} />
      <RecordReward reward={reward}>{heroCard}</RecordReward>
      {saved && <RecordNextActions dex={dex} newTaxonId={reward ? taxon.id : undefined} />}
      {!showMine && refPhoto?.caption && <p className="reference-caption">{refPhoto.caption}</p>}
      {!showMine && refPhoto && <PhotoCredit photo={refPhoto} />}

      <div className="page__body">
        {(myPhoto || refs.length > 1) && (
          <ul className="thumbs" aria-label="사진 바꿔 보기">
            {myPhoto && (
              <li>
                <button className={showMine ? 'is-on' : ''} onClick={() => setHero('mine')} aria-pressed={showMine} aria-label="내가 찍은 사진">
                  <BlobImage blob={myPhoto.display ?? myPhoto.original} alt="" />
                </button>
              </li>
            )}
            {refs.map((p, i) => (
              <li key={p.src}>
                <button className={!showMine && refPhoto === p ? 'is-on' : ''} onClick={() => setHero(i)} aria-pressed={!showMine && refPhoto === p} aria-label={p.caption ?? `참고 사진 ${i + 1}`}>
                  <img src={p.src} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <header className="species-head">
          <div className="species-head__text">
            <p className="kicker">
              {dexIndex >= 0 ? `No.${String(dexIndex + 1).padStart(3, '0')} · ` : ''}
              {taxon.isPlant && taxon.category === 'other' ? '식물' : CATEGORY_LABEL[taxon.category]}
            </p>
            <h1 className="species-title">{taxon.koreanName}</h1>
            <p className="sci">{taxon.scientificName}</p>
          </div>
          {found ? <FoundStamp date={firstSeen} /> : <span className="unfound-chip">미발견</span>}
        </header>
        {taxon.cultivated && <p className="note-line">정원에 심은 식물일 수 있어요</p>}
        <button className="btn btn--primary btn--block" onClick={() => void onShoot()}>
          <Icon name="camera" size={22} /> {found ? '관찰 사진 추가' : '찾았어요! 사진 찍기'}
        </button>
        {fieldPhotos.length > 0 && (
          <section className="sec">
            <div className="sec__head"><h2 className="sec__title">조사팀 현장 사진</h2><span>{fieldPhotos.length}장</span></div>
            <ul className="thumbs" aria-label="현장 사진 원본 보기">
              {fieldPhotos.map((photo) => (
                <li key={photo.id}>
                  <a href={photo.src} target="_blank" rel="noreferrer"><img src={photo.src} alt={`${taxon.koreanName} ${photo.capturedOn ?? ''} 현장 사진`} loading="lazy" /></a>
                </li>
              ))}
            </ul>
            <Link to={`/?public=1&focus=${taxon.id}`} className="more-link"><Icon name="map" size={18} /> 촬영 위치 보기</Link>
          </section>
        )}
        {!!taxon.publicObservations?.length && (
          <section className="sec">
            <div className="sec__head">
              <h2 className="sec__title">공원 공개 관찰 기록</h2>
              <span>{taxon.publicObservations.length}건</span>
            </div>
            <Link to={`/?public=1&focus=${taxon.id}`} className="more-link">
              <Icon name="map" size={18} /> 공개 관찰 지도에서 보기
            </Link>
            <ul className="rows">
              {taxon.publicObservations.map((record) => (
                <li className="public-record" key={record.id}>
                  <span>{record.date} · {'area' in record ? `구역 기록 · ${record.area}` : `관찰 좌표 ${record.lat}, ${record.lng}`}</span>
                  <span className="caption">
                    <a href={record.url} target="_blank" rel="noreferrer">{record.source}</a>
                    {record.credit && ` · ${record.credit}`}
                    {record.license && <> · <a href={record.license} target="_blank" rel="noreferrer">이용 조건</a></>}
                    {'lat' in record && (record.uncertaintyM == null ? ' · 위치 정확도 미제공' : ` · 위치 오차 ${record.uncertaintyM}m`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {taxon.clue.looks.length > 0 && (
          <section className="sec">
            <h2 className="sec__title">알아보는 법</h2>
            <ul className="ticks">
              {taxon.clue.looks.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        {taxon.clue.where && (
          <section className="sec">
            <h2 className="sec__title">만나는 곳</h2>
            <p>{taxon.clue.where}</p>
            {zone && (
              <Link to={`/zone/${zone.id}`} className="more-link">
                {zone.name} 구역 보기 <Icon name="chevron" size={16} />
              </Link>
            )}
          </section>
        )}

        <section className="sec">
          <div className="sec__head">
            <h2 className="sec__title">우리 가족 기록</h2>
            {photoCount > 0 && <span>사진 {photoCount}장</span>}
          </div>
          {mine.length === 0 ? (
            <p className="muted">아직 기록이 없어요. 만나면 사진으로 남겨 보세요.</p>
          ) : (
            <ul className="rows">
              {mine.map(({ obs, photo }, i) => (
                <li key={obs.id}>
                  <Link to="/records" className="row-item">
                    <BlobImage blob={photo?.display ?? null} alt="" className="row-item__thumb" />
                    <span className="row-item__text">
                      <strong>{obs.outsidePark ? '공원 밖' : (zoneById(content, obs.zoneId)?.name ?? '조사구역 밖')}</strong>
                      <span className="muted">
                        {i === mine.length - 1 ? '첫 발견' : '다시 만남'} · {formatDate(obs.observedAt)} {formatTime(obs.observedAt)}
                      </span>
                      <span className="row row--wrap row--tight">
                        <IdStatusBadge status={obs.idStatus} />
                        <SyncBadge sync={obs.sync} />
                      </span>
                    </span>
                    <Icon name="chevron" size={20} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!taxon.publicObservations?.length && !fieldPhotos.length && !!taxon.sightings?.some((spot) => spot[2] === 0) && (
            <div className="sec__actions">
              <Link to={`/?public=0&focus=${taxon.id}`} className="btn btn--secondary btn--block">
                <Icon name="map" size={20} /> 지도에서 관찰 구역 보기
              </Link>
            </div>
          )}
        </section>

        <section className="sec">
          <h2 className="sec__title">언제 많이 보일까요</h2>
          <MonthBars taxon={taxon} content={content} />
        </section>

        {taxon.confusableIds.length > 0 && (
          <section className="sec">
            <h2 className="sec__title">헷갈리는 종</h2>
            <ul className="confusables">
              {taxon.confusableIds.map((cid) => {
                const other = taxonById(content, cid);
                if (!other) return null;
                return (
                  <li key={cid}>
                    <Link to={`/species/${cid}`} className="confusable">
                      <span className="confusable__img">
                        <SpeciesArt taxon={other} size="fill" />
                      </span>
                      <strong>{other.koreanName}</strong>
                      <span className="muted">{other.clue.looks[0]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {taxon.confusableStatus === 'draft' && <p className="caption">헷갈리는 종 묶음은 아직 정하는 중이에요.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
