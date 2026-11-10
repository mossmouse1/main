import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { BrandMark, Compass } from '../components/Illustrations';
import { Stepper } from '../components/Layout';
import { seasonHint } from '../components/MonthBars';
import { ParkMap, type SpeciesPin } from '../components/ParkMap';
import { SpeciesArt } from '../components/SpeciesArt';
import { Tour, type TourStep } from '../components/Tour';
import { useContent } from '../content/ContentProvider';
import { taxonById, zoneById } from '../content/helpers';
import type { Taxon } from '../content/types';
import { db, getMeta, setMeta } from '../data/db';
import { getHousehold, setPartyDefaults } from '../data/household';
import { track } from '../data/track';
import type { ObserverFix } from '../data/types';
import { endWalk, startWalk } from '../data/walks';
import { useActiveWalk, useDex, useHousehold, useNow, useSeason } from '../hooks';
import { distanceM, findZone, inBounds, type LatLng } from '../lib/geo';
import { formatDuration } from '../lib/time';
import { getPosition, watchPosition } from '../platform';

type Filter = 'all' | 'animal' | 'plant' | 'unfound';
const FILTER_LABEL: Record<Filter, string> = { all: '전체', animal: '동물', plant: '식물', unfound: '미발견' };
/** 아이와 걷는 속도(분당 약 67m, 시속 4km) */
const WALK_M_PER_MIN = 67;
/** 아래 시트가 지도 아래쪽을 덮는 높이(px) */
const SHEET_OVERLAP = 20;
const FOCUS_SCALE = 1.5;

const walkMinutes = (m: number) => Math.max(1, Math.round(m / WALK_M_PER_MIN));

const TOUR: TourStep[] = [
  {
    target: () => document.querySelector('.explore .pin.is-selected .pin__bubble'),
    shape: 'circle',
    title: '어디서 만날지 먼저 살펴봐요',
    body: '지도 속 생물을 누르면 관찰 구역과 산책 경로를 볼 수 있어요.',
    note: '실제 만남은 계절과 시간에 따라 달라요',
  },
  {
    target: () => document.querySelector('.target__go'),
    title: '찾으러 함께 걸어가요',
    body: '‘이곳으로 걷기’를 누르면 내 위치에서 가는 길과 걸리는 시간을 보여 줘요.',
    note: '공원 길로만 천천히 다녀요',
  },
  {
    target: () => document.querySelector('.tabbar__fab-circle'),
    shape: 'circle',
    title: '찾으면 사진으로 남겨요',
    body: '사진을 찍고 이름을 확인하면 도감 칸이 열려요.',
    note: '사람 얼굴은 나오지 않게 찍어요',
  },
];

/** S1 탐험(지도 홈): 그림 지도, 구역 이름, 생물 핀, 내 위치, 오늘의 6종, 찾아볼 생물, 탐험 시작 */
export function MapHome() {
  const { content, mapUrl } = useContent();
  const season = useSeason();
  const dex = useDex();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [me, setMe] = useState<ObserverFix | null>(null);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<{ from: LatLng; to: LatLng } | null>(null);
  const [flyTo, setFlyTo] = useState<{ to: LatLng; key: number; scale?: number; exact?: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  const [touring, setTouring] = useState(false);

  // 위치는 지도를 열어 둔 동안만 읽습니다.
  useEffect(
    () =>
      watchPosition(
        (fix) => {
          setMe(fix);
          setDenied(false);
        },
        () => setDenied(true),
      ),
    [],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    void getMeta('tourSeen').then((seen) => {
      if (!seen) timer = setTimeout(() => setTouring(true), 700);
    });
    return () => clearTimeout(timer);
  }, []);

  const outside = !!me && !inBounds(me, content.park.bounds);
  const myFix = outside ? null : me;
  const autoEnded = useLiveQuery(async () => {
    const latest = await db.walks.orderBy('startedAt').reverse().first();
    return latest?.endedBy === 'auto' && !latest.summarySeen ? latest : null;
  }, []);

  // 이번 계절 도감 종 전체(오늘 6종 먼저)
  const seasonTaxa = useMemo(
    () => [...new Set([...season.todaySix, ...season.dex])].map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t?.pin),
    [content, season],
  );
  const found = (id: string) => !!dex?.foundIds.has(id);
  const inFilter = useCallback(
    (t: Taxon, f: Filter) => (f === 'animal' ? t.category !== 'tree' : f === 'plant' ? t.category === 'tree' : f === 'unfound' ? !dex?.foundIds.has(t.id) : true),
    [dex],
  );
  const pins = useMemo<SpeciesPin[]>(
    () =>
      seasonTaxa
        .filter((t) => inFilter(t, filter))
        .map((t) => ({
          id: t.id,
          lat: t.pin!.lat,
          lng: t.pin!.lng,
          label: t.koreanName,
          category: t.category,
          found: !!dex?.foundIds.has(t.id),
          photo: t.photo?.src ?? null,
        })),
    [seasonTaxa, filter, inFilter, dex],
  );

  // 고른 생물이 없으면 오늘 6종 중 아직 못 찾은 첫 종을 찾아봅니다.
  const defaultId = season.todaySix.find((id) => !dex?.foundIds.has(id)) ?? season.todaySix[0];
  const target = taxonById(content, selectedId ?? defaultId);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setRoute(null);
      setHint(false);
      setNotice(null);
      const t = taxonById(content, id);
      if (t?.pin) setFlyTo({ to: t.pin, key: Date.now(), scale: 2 });
    },
    [content],
  );

  // 도감·생물 카드의 ‘지도에서 찾기’(?focus=종)
  useEffect(() => {
    const focus = params.get('focus');
    if (!focus) return;
    select(focus);
    setParams({}, { replace: true });
  }, [params, select, setParams]);

  const onZoneClick = useCallback((id: string) => navigate(`/zone/${id}`), [navigate]);
  const onMapClick = useCallback(() => {
    setSelectedId(null);
    setRoute(null);
  }, []);
  const focusPoint = content.map.focus ? { lat: content.map.focus[0], lng: content.map.focus[1] } : { lat: content.zones[0].center[0], lng: content.zones[0].center[1] };

  const locate = async () => {
    if (denied) {
      setNotice('휴대폰 설정에서 위치 권한을 켜 주세요. 위치 없이도 지도와 기록은 쓸 수 있어요.');
      return;
    }
    const fix = myFix ?? (await getPosition());
    if (fix && inBounds(fix, content.park.bounds)) {
      setMe(fix);
      setFlyTo({ to: fix, key: Date.now(), scale: 2.5 });
    } else if (!fix) setDenied(true);
  };

  const d = myFix && target?.pin ? distanceM(myFix, target.pin) : null;
  const goWalk = () => {
    if (!target?.pin) return;
    track('go_find', { taxonId: target.id });
    if (myFix) {
      setRoute({ from: myFix, to: target.pin });
      setNotice(null);
    } else {
      setFlyTo({ to: target.pin, key: Date.now(), scale: 3 });
      setNotice(denied || outside ? '공원 안에서 위치를 켜면 내 위치에서 가는 길을 보여 줘요.' : '내 위치를 찾는 중이에요. 잠시 뒤 다시 눌러 주세요.');
    }
  };

  const finishTour = useCallback(() => {
    setTouring(false);
    void setMeta('tourSeen', true);
  }, []);

  const foundToday = season.todaySix.filter(found).length;

  return (
    <main className="explore">
      <header className="explore-top">
        <div className="brandbar">
          <BrandMark size={36} />
          <p className="brandbar__text">
            <strong>호수도감</strong>
            <span>
              {content.park.name} · {season.season}
            </span>
          </p>
          <Link to="/dex" className="dex-count" aria-label={`도감 ${dex?.filled ?? 0}칸 채움, 모두 ${dex?.total ?? season.dex.length}칸`}>
            <Icon name="book" size={18} />
            <span>
              <b>{dex?.filled ?? 0}</b> / {dex?.total ?? season.dex.length}
            </span>
          </Link>
        </div>
        <div className="filters" role="group" aria-label="생물 핀 거르기">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} className={`filter${filter === f ? ' is-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
              <span className="filter__n">{seasonTaxa.filter((t) => inFilter(t, f)).length}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="explore-map">
        <ParkMap
          imageUrl={mapUrl}
          bounds={content.park.bounds}
          attribution={content.map.attribution}
          zones={content.zones}
          zoneMode="label"
          onZoneClick={onZoneClick}
          facilities={content.facilities}
          speciesPins={pins}
          selectedId={target?.id ?? null}
          onSpeciesClick={select}
          onMapClick={onMapClick}
          me={myFix}
          route={route}
          routeLabel={d != null ? `도보 약 ${walkMinutes(d)}분` : undefined}
          flyTo={flyTo}
          focus={focusPoint}
          focusScale={FOCUS_SCALE}
          bottomInset={SHEET_OVERLAP}
        />

        <div className="map-stack">
          <WalkPill />
          {outside && (
            <p className="map-note map-note--warn" role="status">
              <Icon name="pin" size={18} /> 공원 밖에 있어요. 기록은 남길 수 있지만 ‘공원 밖’으로 표시돼요.
            </p>
          )}
          {notice && (
            <p className="map-note" role="status">
              {notice}
            </p>
          )}
          {autoEnded && (
            <Link to={`/walk/summary?id=${autoEnded.id}`} className="map-note map-note--link">
              <Icon name="clock" size={18} /> 지난 탐험이 자동으로 끝났어요 · 요약 보기
            </Link>
          )}
        </div>

        <div className="map-tools">
          <button onClick={() => setFlyTo({ to: focusPoint, key: Date.now(), scale: FOCUS_SCALE, exact: true })} aria-label="처음 보던 곳으로">
            <Compass />
          </button>
          <button onClick={() => void locate()} aria-label={denied ? '위치 권한 안내' : '내 위치로'}>
            <Icon name={denied ? 'question' : 'locate'} size={24} />
          </button>
        </div>
      </div>

      <section className="explore-sheet" aria-label="오늘 찾을 생물">
        <div className="today">
          <div className="today__head">
            <h2>오늘의 6종</h2>
            <span>
              <b>{foundToday}</b> / 6 찾음
            </span>
          </div>
          <ul className="today__list">
            {season.todaySix.map((id) => {
              const t = taxonById(content, id);
              if (!t) return null;
              return (
                <li key={id}>
                  <button
                    className={`avatar${id === target?.id ? ' is-on' : ''}${found(id) ? ' is-found' : ''}`}
                    onClick={() => select(id)}
                    aria-label={`${t.koreanName}${found(id) ? ', 찾음' : ''}`}
                    aria-pressed={id === target?.id}
                  >
                    <SpeciesArt taxon={t} size="fill" />
                    {found(id) && (
                      <span className="avatar__check">
                        <Icon name="check" size={11} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {target && <TargetCard taxon={target} found={found(target.id)} distance={d} hint={hint} onHint={() => setHint((v) => !v)} onGo={goWalk} routing={!!route} />}
      </section>

      {touring && <Tour steps={TOUR} label="탐험 가이드" onDone={finishTour} />}
    </main>
  );
}

function TargetCard({ taxon, found, distance, hint, onHint, onGo, routing }: {
  taxon: Taxon;
  found: boolean;
  distance: number | null;
  hint: boolean;
  onHint: () => void;
  onGo: () => void;
  routing: boolean;
}) {
  const { content } = useContent();
  const zone = (taxon.pin ? findZone(taxon.pin, content.zones) : null) ?? zoneById(content, taxon.clue.zoneIds[0]);
  const months = seasonHint(taxon.monthCounts);
  return (
    <article className="target">
      <div className="target__main">
        <Link to={`/species/${taxon.id}`} className="target__photo" aria-label={`${taxon.koreanName} 생물 카드`}>
          <SpeciesArt taxon={taxon} size="fill" />
        </Link>
        <div className="target__text">
          <p className="kicker">{found ? '우리 가족이 찾은 생물' : '찾아볼 생물'}</p>
          <h3>
            <Link to={`/species/${taxon.id}`}>{taxon.koreanName}</Link>
          </h3>
          <p className="target__meta">
            <Icon name="pin" size={15} />
            {zone?.name ?? '공원 주변'}
            {distance != null && <> · 걸어서 {walkMinutes(distance)}분</>}
          </p>
          {months && <span className={`season-tag${months.good ? ' is-good' : ''}`}>{months.text}</span>}
        </div>
      </div>
      <div className="target__actions">
        <button className="btn btn--primary target__go" onClick={onGo}>
          <Icon name="walk" size={22} /> {routing ? '길 다시 보기' : '이곳으로 걷기'}
        </button>
        <button className={`btn btn--secondary${hint ? ' is-on' : ''}`} onClick={onHint} aria-expanded={hint}>
          <Icon name="binoculars" size={20} /> 생김새 힌트
        </button>
      </div>
      {hint && (
        <div className="hint">
          <ul className="ticks">
            {taxon.clue.looks.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {taxon.clue.where && <li>{taxon.clue.where}</li>}
          </ul>
          <p className="caption">
            핀은 {taxon.pin?.basis === 'records' ? `공개 기록 ${taxon.pin.records}건이 모인 곳` : '단서 구역'}이에요. 계절과 시간에 따라 못 만날 수도 있어요.{' '}
            <Link to={`/species/${taxon.id}`}>생물 카드</Link>
          </p>
        </div>
      )}
    </article>
  );
}

/** 탐험 시작·끝. 누르지 않아도 첫 기록을 저장하면 자동으로 시작됩니다. */
function WalkPill() {
  const walk = useActiveWalk();
  const household = useHousehold();
  const now = useNow(30_000);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [adults, setAdults] = useState<number | null>(null);
  const [children, setChildren] = useState<number | null>(null);

  if (walk === undefined) return null;

  if (walk) {
    const minutes = Math.max(0, Math.round((now - Date.parse(walk.startedAt)) / 60000));
    return (
      <div className="walk-pill is-active">
        <span className="live-dot" aria-hidden="true" />
        <span>탐험 중 · {formatDuration(minutes)}</span>
        <button
          onClick={async () => {
            const ended = await endWalk(walk.id, 'manual');
            navigate(`/walk/summary?id=${ended.id}`);
          }}
        >
          끝내기
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        className="walk-pill"
        aria-expanded={asking}
        onClick={async () => {
          if (asking) return setAsking(false);
          const h = household ?? (await getHousehold());
          setAdults(h.adults);
          setChildren(h.children);
          setAsking(true);
        }}
      >
        <Icon name="walk" size={18} /> 탐험 시작
      </button>
      {asking && (
        <div className="walk-ask">
          <p>오늘 함께 온 사람 (선택)</p>
          <Stepper label="어른" value={adults} onChange={setAdults} />
          <Stepper label="아이" value={children} onChange={setChildren} />
          <div className="row">
            <button className="btn btn--secondary btn--small" onClick={() => setAsking(false)}>
              닫기
            </button>
            <button
              className="btn btn--primary btn--small"
              onClick={async () => {
                await setPartyDefaults(adults, children);
                await startWalk({ adults, children });
                setAsking(false);
              }}
            >
              시작
            </button>
          </div>
        </div>
      )}
    </>
  );
}
