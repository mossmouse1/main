import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CategoryIcon } from '../components/CategoryIcon';
import { Icon } from '../components/Icon';
import { ParkMap, type PhotoPin } from '../components/ParkMap';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { seasonContains, taxonById, zoneById } from '../content/helpers';
import type { Taxon } from '../content/types';
import { Tour, type TourStep } from '../components/Tour';
import { db, getMeta, setMeta } from '../data/db';
import { startDraft } from '../data/draft';
import { appendFix, loadTrack, onTrack, trackSegments, type TrackPoint } from '../data/trackLog';
import { track } from '../data/track';
import { endWalk } from '../data/walks';
import { useActiveWalk, useDex, useNow, useSeason } from '../hooks';
import { distanceM, findZone, formatDistance, inBounds, type LatLng } from '../lib/geo';
import { describePlace } from '../lib/place';
import { formatDuration } from '../lib/time';
import { pathLength, routeOnTrail } from '../lib/trail';
import { getPosition, watchPosition, type LiveFix } from '../platform';

/** 아이와 걷는 속도(분당 약 67m, 시속 4km) */
const WALK_M_PER_MIN = 67;
/** 이 거리 안에 못 찾은 생물 기록 지점이 있으면 알려 줍니다. */
const ALERT_M = 45;
/** 지도 위·아래를 가리는 떠 있는 UI 높이(px, 아래는 아래쪽 버튼 포함). 가운데 맞출 때 보이는 영역 기준으로 씁니다. */
const TOP_INSET = 96;
const BOTTOM_INSET = 250;
const BOTTOM_INSET_CARD = 320;

/**
 * 코치마크(처음 한 번). 처음 안내 슬라이드 대신, 실제 화면에서 할 일 순서대로 짚어 줍니다.
 * 무엇을 찾나(다음 생물) → 어디서(지도 위 칸) → 찾으면(촬영) → 모으기(오늘의 6종) → 위치 켜기.
 * 마지막 단계의 버튼이 위치 권한을 묻습니다.
 */
const COACH: TourStep[] = [
  {
    target: () => document.querySelector('.next'),
    title: '오늘 찾을 생물이에요',
    body: '아직 못 찾은 생물 중 가장 가까운 하나를 알려 줘요. 누르면 지도에서 그 생물이 있는 곳을 보여 줘요.',
  },
  {
    target: () => document.querySelector('.ph.is-empty .ph__card') ?? document.querySelector('.ph .ph__card'),
    shape: 'circle',
    title: '점선 칸이 만날 수 있는 곳',
    body: '공개 기록에서 이 생물이 보인 산책로예요. 찾으면 이 칸이 내가 찍은 사진으로 채워져요.',
    note: '계절과 시간에 따라 못 만날 수도 있어요',
  },
  {
    target: () => document.querySelector('.dock__shoot-btn'),
    title: '찾으면 찰칵!',
    body: '사진을 찍고 이름을 확인하면 도감 칸이 열려요.',
    note: '사람 얼굴은 나오지 않게 찍어요',
  },
  {
    target: () => document.querySelector('.tray'),
    title: '오늘의 6종을 모아요',
    body: '찾을 때마다 칸이 하나씩 사진으로 채워져요. 칸을 누르면 그 생물이 있는 곳으로 가요.',
  },
  {
    target: () => document.querySelector('.hud-tool'),
    title: '내 위치를 켜면 더 쉬워요',
    body: '지금 걷는 곳과 걸어온 길을 지도에 그려 주고, 생물 가까이 가면 알려 줘요.',
    note: '위치는 이 휴대폰에만 두고 보내지 않아요',
  },
];
/** 처음 배율(가장 작은 배율 = 그림이 화면을 꽉 채우는 배율의 몇 배) */
const FOCUS_SCALE = 1.05;

const walkMinutes = (m: number) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
const toLatLng = ([lat, lng]: [number, number, number]): LatLng => ({ lat, lng });

/**
 * S1 탐험(지도 홈). 쿼터뷰 블록 지도가 화면 전체를 채우고, 그 위에는 꼭 필요한 것만 둡니다.
 *
 * 위계(중요한 순서)
 * 1. 지도와 그 위의 ‘빈 칸’(못 찾은 생물) · ‘사진 딱지’(찾은 생물) — 무엇을 찾을지
 * 2. 아래 가운데 촬영 버튼(Layout의 아래쪽 버튼) — 찾았을 때 할 일
 * 3. 오늘의 6종 칸(진행 상황) — 얼마나 채웠는지
 * 4. 그때그때만 나오는 것: 근처 생물 알림, 고른 생물 카드, 탐험 중 표시
 * 거르기·가까운 생물 목록·나침반·탐험 시작 버튼은 뺐습니다(도감 화면과 자동 시작이 대신함).
 */
export function MapHome() {
  const { content, mapUrl, isoUrl, trails } = useContent();
  const iso = isoUrl ? content.map.iso ?? null : null;
  const season = useSeason();
  const dex = useDex();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [me, setMe] = useState<LiveFix | null>(null);
  const [denied, setDenied] = useState(false);
  const [follow, setFollow] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickIds, setPickIds] = useState<string[] | null>(null);
  const [route, setRoute] = useState<{ from: LatLng; to: LatLng; path: LatLng[] | null; meters: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ to: LatLng; key: number; scale?: number; exact?: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  const [trackPts, setTrackPts] = useState<TrackPoint[]>([]);
  /** 코치마크: unknown(읽는 중) → show(처음 연 사람) → done */
  const [coach, setCoach] = useState<'unknown' | 'show' | 'done'>('unknown');

  useEffect(() => {
    let alive = true;
    void getMeta('tourSeen').then((seen) => alive && setCoach(seen ? 'done' : 'show'));
    return () => {
      alive = false;
    };
  }, []);

  // 위치는 지도를 열어 둔 동안만 읽고, 걸어온 길은 기기에만 둡니다.
  // 처음 연 사람에게는 코치마크 마지막 단계(위치 켜기)를 본 뒤에 위치 권한을 묻습니다(갑자기 권한 창이 뜨지 않게).
  useEffect(() => {
    if (coach !== 'done') return;
    return watchPosition(
      (fix) => {
        setMe(fix);
        setDenied(false);
        if (inBounds(fix, content.park.bounds)) void appendFix(fix);
      },
      () => setDenied(true),
    );
  }, [coach, content.park.bounds]);
  useEffect(() => {
    void loadTrack().then(setTrackPts);
    return onTrack(setTrackPts);
  }, []);

  const outside = !!me && !inBounds(me, content.park.bounds);
  const myFix = outside ? null : me;
  const autoEnded = useLiveQuery(async () => {
    const latest = await db.walks.orderBy('startedAt').reverse().first();
    return latest?.endedBy === 'auto' && !latest.summarySeen ? latest : null;
  }, []);

  // 이번 계절 도감 종(오늘 6종 먼저) 중 지도 지점이 있는 종
  const seasonTaxa = useMemo(
    () => [...new Set([...season.todaySix, ...season.dex])].map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t?.sightings?.length),
    [content, season],
  );
  const found = useCallback((id: string) => !!dex?.foundIds.has(id), [dex]);

  // 아직 못 찾은 생물의 공개 기록 지점이 바로 옆이면 알려 줍니다(오늘 6종이 아니어도).
  const alert = useMemo(() => {
    if (!myFix) return null;
    let best: { t: Taxon; d: number } | null = null;
    for (const t of seasonTaxa) {
      if (found(t.id)) continue;
      for (const s of t.sightings ?? []) {
        if (s[2] === 0) continue;
        const d = distanceM(myFix, toLatLng(s));
        if (d <= ALERT_M && (!best || d < best.d)) best = { t, d };
      }
    }
    return best;
  }, [myFix, seasonTaxa, found]);
  const alertId = alert?.t.id ?? null;

  /**
   * 지도에 띄우는 것: 오늘의 6종(+ 고른 생물, 근처 알림 생물)만.
   * 못 찾은 생물은 지점마다 ‘빈 칸’, 찾은 생물은 우리 가족이 찍은 자리의 ‘사진 딱지’로 바뀝니다(찍은 사진이 기기에 없으면 대표 지점 한 곳).
   */
  const mine = useMyPhotoPins(season);
  const photoPins = useMemo<PhotoPin[]>(() => {
    const shown = new Set<string>(season.todaySix);
    if (selectedId) shown.add(selectedId);
    if (alertId) shown.add(alertId);
    const pins: PhotoPin[] = [];
    for (const t of seasonTaxa) {
      if (!shown.has(t.id)) continue;
      const isFound = found(t.id);
      const spots = isFound && t.id !== selectedId ? (mine.some((p) => p.taxonId === t.id) ? [] : t.sightings!.slice(0, 1)) : t.sightings!;
      spots.forEach(([lat, lng, n], i) =>
        pins.push({ key: `${t.id}:${i}`, taxonId: t.id, lat, lng, label: t.koreanName, category: t.category, photo: t.photo?.src ?? null, kind: n > 0 ? 'record' : 'hint', found: isFound }),
      );
    }
    return [...pins, ...mine];
  }, [season, seasonTaxa, selectedId, alertId, found, mine]);

  /** 종마다 내게서 가장 가까운 지점 */
  const nearest = useCallback(
    (t: Taxon): { at: LatLng; d: number | null } | null => {
      const spots = t.sightings?.map(toLatLng) ?? [];
      if (!spots.length) return null;
      if (!myFix) return { at: spots[0], d: null };
      return spots.map((at) => ({ at, d: distanceM(myFix, at) })).sort((a, b) => a.d - b.d)[0];
    },
    [myFix],
  );

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setPickIds(null);
      setRoute(null);
      setHint(false);
      setNotice(null);
      const t = taxonById(content, id);
      const spot = t ? nearest(t) : null;
      if (spot) {
        setFollow(false);
        setFlyTo({ to: spot.at, key: Date.now(), scale: 2 });
      }
    },
    [content, nearest],
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
    setPickIds(null);
    setRoute(null);
  }, []);
  const onUserMove = useCallback(() => setFollow(false), []);
  const focusPoint = content.map.focus ? { lat: content.map.focus[0], lng: content.map.focus[1] } : { lat: content.zones[0].center[0], lng: content.zones[0].center[1] };

  /** 하나뿐인 지도 버튼: 내 위치로 가서 따라가기 */
  const locate = async () => {
    if (denied) {
      setNotice('휴대폰 설정에서 위치 권한을 켜 주세요. 위치 없이도 지도와 기록은 쓸 수 있어요.');
      return;
    }
    const fix = myFix ?? (await getPosition());
    if (fix && inBounds(fix, content.park.bounds)) {
      if (!myFix) setMe({ ...fix, heading: null });
      setNotice(null);
      setFollow(true);
      setFlyTo({ to: fix, key: Date.now(), scale: 2.5 });
    } else if (fix) {
      setNotice(`지금은 공원 밖이에요. 호수공원까지 ${formatDistance(distanceM(fix, focusPoint))}예요.`);
    } else setDenied(true);
  };

  const shoot = async (taxonId: string) => {
    await startDraft(taxonId);
    navigate('/record/photo');
  };

  const target = taxonById(content, selectedId);
  const targetSpot = target ? nearest(target) : null;
  const goWalk = () => {
    if (!target || !targetSpot) return;
    track('go_find', { taxonId: target.id });
    if (myFix) {
      const path = trails.pts.length ? routeOnTrail(trails, myFix, targetSpot.at) : null;
      setRoute({ from: myFix, to: targetSpot.at, path, meters: path ? pathLength(path) : distanceM(myFix, targetSpot.at) });
      setFollow(false);
      setNotice(null);
    } else {
      setFlyTo({ to: targetSpot.at, key: Date.now(), scale: 3 });
      setNotice(denied || outside ? '공원 안에서 위치를 켜면 내 위치에서 가는 길을 보여 줘요.' : '내 위치를 찾는 중이에요. 잠시 뒤 다시 눌러 주세요.');
    }
  };

  const segments = useMemo(() => trackSegments(trackPts), [trackPts]);
  // 지금 걷는 곳은 버튼이 아니라 내 위치 점 아래 이름표로 보여 줍니다.
  const place = myFix ? describePlace(content, myFix) : null;
  const sixTaxa = season.todaySix.map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t);
  const pickTaxa = pickIds?.map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t) ?? null;
  const foundSix = sixTaxa.filter((t) => found(t.id)).length;

  /**
   * 홈 위쪽에 하나만 두는 것: ‘다음에 찾을 생물’.
   * 진행도는 아래 칸 받침이, 남은 거리는 이 카드의 ‘걸어서 n분’이 대신합니다.
   * 오늘의 6종 중 못 찾은 것 — 위치가 있으면 가장 가까운 것, 없으면 순서대로 첫 번째.
   */
  const next = useMemo(() => {
    const left = sixTaxa.filter((t) => !found(t.id));
    if (!left.length) return null;
    const withD = left.map((t) => ({ t, spot: nearest(t) }));
    if (myFix) withD.sort((a, b) => (a.spot?.d ?? Infinity) - (b.spot?.d ?? Infinity));
    return withD[0];
  }, [sixTaxa, found, nearest, myFix]);

  const finishCoach = useCallback(
    (finished: boolean) => {
      void setMeta('tourSeen', true);
      setCoach('done');
      // 끝까지 본 사람은 마지막 버튼(위치 켜고 시작)으로 위치 권한을 묻고 내 위치로 갑니다.
      if (finished) void locate();
    },
    // locate는 매번 새로 만들어지지만, 코치마크는 한 번만 끝나므로 처음 것을 써도 됩니다.
    [],
  );

  return (
    <main className="explore">
      <div className="explore-map">
        <ParkMap
          imageUrl={iso ? isoUrl! : mapUrl}
          iso={iso}
          bounds={content.park.bounds}
          zones={content.zones}
          zoneMode="label"
          onZoneClick={onZoneClick}
          facilities={content.facilities}
          photoPins={photoPins}
          onClusterPick={setPickIds}
          selectedId={target?.id ?? null}
          onSpeciesClick={select}
          onMapClick={onMapClick}
          me={myFix}
          meLabel={place?.name}
          track={segments}
          follow={follow && !!myFix && !selectedId}
          onUserMove={onUserMove}
          route={route}
          routeLabel={route ? `도보 약 ${walkMinutes(route.meters)}분` : undefined}
          flyTo={flyTo}
          focus={focusPoint}
          focusScale={FOCUS_SCALE}
          topInset={TOP_INSET}
          bottomInset={target ? BOTTOM_INSET_CARD : BOTTOM_INSET}
        />
      </div>

      {/* 위: ‘다음에 찾을 생물’ 한 장. 생물 가까이 가면 같은 자리가 노란 알림으로 바뀌고, 생물을 고르면 비웁니다. */}
      <header className="hud-top">
        {alert && alert.t.id !== selectedId ? (
          <div className="next is-alert" role="status">
            <button className="next__main" onClick={() => select(alert.t.id)} aria-label={`${alert.t.koreanName} 자리 보기`}>
              <span className={`next__photo ring--${alert.t.category}`}>
                <SpeciesArt taxon={alert.t} size="fill" />
              </span>
              <span className="next__text">
                <small>바로 근처에서 기록됐어요!</small>
                <strong>{alert.t.koreanName}</strong>
              </span>
            </button>
            <button className="next__act" onClick={() => void shoot(alert.t.id)}>
              <Icon name="camera" size={20} />
              찾았어요
            </button>
          </div>
        ) : !target && next ? (
          <div className="next">
            <button className="next__main" onClick={() => select(next.t.id)}>
              <span className={`next__photo ring--${next.t.category}`}>
                <SpeciesArt taxon={next.t} size="fill" />
              </span>
              <span className="next__text">
                <small>다음에 찾을 생물</small>
                <strong>{next.t.koreanName}</strong>
              </span>
              <span className="next__meta">
                {next.spot?.d != null ? (
                  <>
                    <b>{walkMinutes(next.spot.d)}분</b>
                    <span>걸어서</span>
                  </>
                ) : (
                  <span>{zoneLabel(content, next.t)}</span>
                )}
              </span>
              <Icon name="chevron" size={20} />
            </button>
          </div>
        ) : !target && sixTaxa.length > 0 && foundSix === sixTaxa.length ? (
          <Link to="/dex" className="next is-done">
            <span className="next__main">
              <span className="next__badge">
                <Icon name="check" size={26} />
              </span>
              <span className="next__text">
                <small>오늘의 6종을 모두 찾았어요!</small>
                <strong>도감에서 다른 생물 보기</strong>
              </span>
              <Icon name="chevron" size={20} />
            </span>
          </Link>
        ) : null}
        <WalkPill />
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
      </header>

      <section className="hud-bottom" aria-label={target ? `${target.koreanName} 찾기` : '오늘의 6종'}>
        {/* 지도 출처(왼쪽)와 내 위치 버튼(오른쪽)을 한 줄에 */}
        <div className="hud-bar">
          {content.map.attribution && <p className="hud-credit">{content.map.attribution}</p>}
          <button className={`hud-tool${follow && myFix ? ' is-on' : ''}`} onClick={() => void locate()} aria-label={denied ? '위치 권한 안내' : '내 위치로'} aria-pressed={follow && !!myFix}>
            <Icon name={denied ? 'question' : 'locate'} size={24} />
          </button>
        </div>
        {target ? (
          <FocusCard
            taxon={target}
            found={found(target.id)}
            distance={route ? route.meters : targetSpot?.d ?? null}
            routing={!!route}
            hint={hint}
            onHint={() => setHint((v) => !v)}
            onGo={goWalk}
            onShoot={() => void shoot(target.id)}
            onClose={() => select(null)}
          />
        ) : pickTaxa ? (
          <SlotTray title={`이곳의 생물 ${pickTaxa.length}종`} taxa={pickTaxa} found={found} onPick={select} onClose={() => setPickIds(null)} />
        ) : (
          <SlotTray title="오늘의 6종" count={foundSix} total={sixTaxa.length} taxa={sixTaxa} found={found} onPick={select} />
        )}
      </section>

      {coach === 'show' && <Tour steps={COACH} label="처음 사용 안내" finishLabel="위치 켜고 시작하기" onDone={finishCoach} />}
    </main>
  );
}

/** 지도에 쓰는 쉬운 구역 이름(물가 풀숲 등) */
function zoneLabel(content: ReturnType<typeof useContent>['content'], t: Taxon): string {
  const zone = (t.pin ? findZone(t.pin, content.zones) : null) ?? zoneById(content, t.clue.zoneIds[0]);
  return zone?.mapLabel ?? zone?.name ?? '공원 안';
}

/**
 * 칸 받침: 오늘의 6종(또는 한곳에 모인 생물들)을 한 줄 칸으로.
 * 못 찾은 칸은 점선 빈 칸(분류 그림자), 찾은 칸은 사진으로 채워집니다. 칸을 누르면 지도에서 그 생물 자리로 갑니다.
 */
function SlotTray({ title, count, total, taxa, found, onPick, onClose }: {
  title: string;
  count?: number;
  total?: number;
  taxa: Taxon[];
  found: (id: string) => boolean;
  onPick: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="tray">
      <div className="tray__head">
        <h2>{title}</h2>
        {count != null && total != null && (
          <span className="tray__count" aria-label={`${total}종 중 ${count}종 찾음`}>
            <b>{count}</b> / {total}
          </span>
        )}
        {onClose && (
          <button className="tray__close" onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <ul className="tray__slots" style={{ gridTemplateColumns: `repeat(${Math.max(taxa.length, 6)}, 1fr)` }}>
        {taxa.map((t) => (
          <li key={t.id}>
            <button className={`slot slot--${t.category}${found(t.id) ? ' is-found' : ''}`} onClick={() => onPick(t.id)} aria-label={`${t.koreanName}${found(t.id) ? ', 찾음' : ', 아직 못 찾음'}`}>
              {found(t.id) ? (
                <>
                  <SpeciesArt taxon={t} size="fill" />
                  <span className="slot__check">
                    <Icon name="check" size={10} />
                  </span>
                </>
              ) : (
                <CategoryIcon category={t.category} size={22} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 고른 생물: 무엇인지(사진·이름·어디) + 할 일 하나(찾으러 가기 → 찾았어요). 자세한 내용은 사진을 눌러 생물 카드에서 봅니다. */
function FocusCard({ taxon, found, distance, routing, hint, onHint, onGo, onShoot, onClose }: {
  taxon: Taxon;
  found: boolean;
  distance: number | null;
  routing: boolean;
  hint: boolean;
  onHint: () => void;
  onGo: () => void;
  onShoot: () => void;
  onClose: () => void;
}) {
  const { content } = useContent();
  return (
    <article className="focus">
      <button className="focus__close" onClick={onClose} aria-label="닫기">
        <Icon name="close" size={18} />
      </button>
      <div className="focus__main">
        <Link to={`/species/${taxon.id}`} className="focus__photo" aria-label={`${taxon.koreanName} 생물 카드`}>
          <SpeciesArt taxon={taxon} size="fill" />
        </Link>
        <div className="focus__text">
          <p className="kicker">{found ? '우리 가족이 찾은 생물' : '찾아볼 생물'}</p>
          <h3>
            <Link to={`/species/${taxon.id}`}>{taxon.koreanName}</Link>
          </h3>
          <p className="focus__meta">
            <Icon name="pin" size={15} />
            {zoneLabel(content, taxon)}
            {distance != null && <> · 걸어서 {walkMinutes(distance)}분</>}
          </p>
        </div>
      </div>
      <div className="focus__actions">
        {routing ? (
          <button className="btn btn--primary focus__go" onClick={onShoot}>
            <Icon name="camera" size={22} /> 찾았어요! 찍기
          </button>
        ) : (
          <button className="btn btn--primary focus__go" onClick={onGo}>
            <Icon name="walk" size={22} /> 찾으러 가기
          </button>
        )}
        <button className={`btn btn--secondary${hint ? ' is-on' : ''}`} onClick={onHint} aria-expanded={hint}>
          <Icon name="binoculars" size={20} /> 힌트
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
          <p className="caption">계절과 시간에 따라 못 만날 수도 있어요.</p>
        </div>
      )}
    </article>
  );
}

/**
 * 탐험 중일 때만 보입니다(시간 · 끝내기).
 * 탐험은 첫 기록을 저장하면 자동으로 시작되므로 시작 버튼은 두지 않습니다.
 */
function WalkPill() {
  const walk = useActiveWalk();
  const now = useNow(30_000);
  const navigate = useNavigate();
  if (!walk) return null;
  const minutes = Math.max(0, Math.round((now - Date.parse(walk.startedAt)) / 60000));
  return (
    <div className="walk-pill">
      <span className="live-dot" aria-hidden="true" />
      <span>탐험 {formatDuration(minutes)}</span>
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

/** 우리 가족이 이번 계절에 찍은 사진을 찍은 자리에 딱지로(가장 최근 40장) */
function useMyPhotoPins(season: ReturnType<typeof useSeason>): PhotoPin[] {
  const { content } = useContent();
  const rows = useLiveQuery(async () => {
    const obs = (await db.observations.orderBy('createdAt').reverse().toArray()).filter((o) => !o.hidden && o.taxonId && seasonContains(season, o.observedAt)).slice(0, 40);
    return Promise.all(
      obs.map(async (o) => {
        const photo = o.photoIds[0] ? await db.photos.get(o.photoIds[0]) : undefined;
        return { obs: o, blob: photo?.display ?? photo?.original ?? null };
      }),
    );
  }, [season.id]);
  const [pins, setPins] = useState<PhotoPin[]>([]);
  useEffect(() => {
    const urls: string[] = [];
    setPins(
      (rows ?? []).flatMap(({ obs, blob }) => {
        const t = taxonById(content, obs.taxonId);
        if (!t) return [];
        let photo = t.photo?.src ?? null;
        if (blob) {
          photo = URL.createObjectURL(blob);
          urls.push(photo);
        }
        return [{ key: `mine:${obs.id}`, taxonId: t.id, lat: obs.subject.lat, lng: obs.subject.lng, label: t.koreanName, category: t.category, photo, kind: 'mine' as const, found: true }];
      }),
    );
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [rows, content]);
  return pins;
}
