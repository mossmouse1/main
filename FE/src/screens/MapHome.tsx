import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CategoryIcon } from '../components/CategoryIcon';
import { Icon } from '../components/Icon';
import { MapAttribution } from '../components/MapAttribution';
import { ParkMap, type PhotoPin } from '../components/ParkMap';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { taxonById, zoneById } from '../content/helpers';
import type { Content, Taxon } from '../content/types';
import { Tour, type TourStep } from '../components/Tour';
import { useCommunityMap } from '../data/communityMap';
import { db } from '../data/db';
import { startDraft } from '../data/draft';
import { appendFix, loadTrack, onTrack, trackSegments, type TrackPoint } from '../data/trackLog';
import { track } from '../data/track';
import { endWalk } from '../data/walks';
import { useActiveWalk, useDex, useNow, useSeason } from '../hooks';
import { questMapUrl } from '../lib/dex';
import { distanceM, findZone, formatDistance, inBounds, type LatLng } from '../lib/geo';
import { describePlace } from '../lib/place';
import { isRewardMuted, setRewardMuted } from '../lib/rewardAudio';
import { formatDuration } from '../lib/time';
import { pathLength, routeOnTrail, snapToTrail } from '../lib/trail';
import { getPosition, locationPermission, watchPosition, type LiveFix } from '../platform';

/** 아이와 걷는 속도(분당 약 67m, 시속 4km) */
const WALK_M_PER_MIN = 67;
/** 이 거리 안에 못 찾은 생물 기록 지점이 있으면 알려 줍니다. */
const ALERT_M = 45;
/** 지도 위·아래를 가리는 떠 있는 UI 높이(px, 아래는 아래쪽 버튼 포함). 가운데 맞출 때 보이는 영역 기준으로 씁니다. */
const TOP_INSET = 126;
const BOTTOM_INSET = 169;
const BOTTOM_INSET_CARD = 232;

const EXPLORATION_GUIDE: TourStep[] = [
  {
    target: () => document.querySelector('.quest-invitation') ?? document.querySelector('.next'),
    title: '지도에서 찾아볼 생물을 골라요',
    body: '이번 계절에 찾아볼 수 있는 생물 중 원하는 종부터 찍어요. 위치를 켜면 가까운 관찰 기록부터 볼 수 있어요.',
  },
  {
    target: () => document.querySelector('.dock__shoot-btn'),
    title: '공원에서 찍고 이름을 확인해요',
    body: '촬영 버튼을 눌러 사진을 찍고, 생물이 있던 곳과 이름을 확인하세요. ‘맞아요, 도감에 등록’을 누르면 사진이 저장돼요.',
  },
  {
    target: () => document.querySelector('.dock__dex'),
    title: '아래 도감에서 모은 종을 확인해요',
    body: '하단 ‘도감’의 ‘계절 퀘스트’에서 체크 표시가 붙은 칸을 확인하세요.',
  },
  {
    target: () => document.querySelector('.dock__dex'),
    title: '10칸을 모두 채우면 완료예요',
    body: '도감에서 ‘퀘스트 완료 사진 보기’를 눌러 내가 찍은 사진으로 만든 이미지를 열어요. 리워드를 받을 때 현장 운영진에게 보여 주세요.',
  },
];
/** 처음 배율(가장 작은 배율 = 그림이 화면을 꽉 채우는 배율의 몇 배) */
const FOCUS_SCALE = 1.05;

const walkMinutes = (m: number) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
const toLatLng = ([lat, lng]: [number, number, number]): LatLng => ({ lat, lng });
type MapSpot = LatLng & { kind: 'record' | 'area' | 'hint' | 'community'; label?: string; key?: string };
const canRouteTo = (spot?: MapSpot | null) => spot?.kind === 'record' || spot?.kind === 'hint';

function mapSpots(content: Content, taxon: Taxon, publicOnly = false): MapSpot[] {
  const observations = taxon.publicObservations ?? [];
  const field = (content.fieldPhotos ?? []).flatMap((photo) => photo.taxonId === taxon.id && photo.location
    ? [{ ...photo.location, kind: 'record' as const }] : []);
  const points = [...field, ...observations.flatMap((record) => 'lat' in record ? [{ lat: record.lat, lng: record.lng, kind: 'record' as const }] : [])];
  if (points.length && !publicOnly) return points;
  const seenAreas = new Set<string | undefined>();
  const areas: MapSpot[] = [];
  for (const record of observations) {
    if (!('area' in record) || seenAreas.has(record.zoneId)) continue;
    seenAreas.add(record.zoneId);
    const zone = zoneById(content, record.zoneId);
    const at = zone?.center ?? content.map.focus;
    if (at) areas.push({ lat: at[0], lng: at[1], kind: 'area', label: zone?.name ?? `${content.park.name} 일대` });
  }
  if (points.length || areas.length) return [...points, ...areas];
  return publicOnly ? [] : (taxon.sightings ?? []).filter((s) => s[2] === 0).map((s) => ({ ...toLatLng(s), kind: 'hint' }));
}

/**
 * S1 탐험(지도 홈). 쿼터뷰 블록 지도가 화면 전체를 채우고, 그 위에는 꼭 필요한 것만 둡니다.
 *
 * 위계(중요한 순서)
 * 1. 공개 관찰·가족 관찰 격자와 내가 찍은 위치
 * 2. 아래 가운데 촬영 버튼(Layout의 아래쪽 버튼) — 찾았을 때 할 일
 * 3. 계절 퀘스트 칸 — 얼마나 채웠는지
 * 4. 그때그때만 나오는 것: 근처 생물 알림, 고른 생물 카드, 탐험 중 표시
 */
export function MapHome() {
  const { content, mapUrl, isoUrl, trails } = useContent();
  const iso = isoUrl ? content.map.iso ?? null : null;
  const season = useSeason();
  const dex = useDex();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const guide = params.get('guide');
  const startingGuide = guide === 'quest';
  const showGuide = startingGuide || guide === '1';
  const fieldTaxa = useMemo(() => new Set((content.fieldPhotos ?? []).flatMap((photo) => photo.taxonId ? [photo.taxonId] : [])), [content]);
  const publicTaxa = useMemo(() => content.taxa.filter((taxon) => taxon.publicObservations?.length || fieldTaxa.has(taxon.id)), [content, fieldTaxa]);
  const showPublic = params.get('public') !== '0';
  const community = useCommunityMap();
  const mine = useMyPhotoPins();
  const communityByTaxon = useMemo(() => {
    const byTaxon = new Map<string, MapSpot[]>();
    for (const cell of community) {
      const spots = byTaxon.get(cell.taxon_id) ?? [];
      spots.push({
        lat: cell.lat, lng: cell.lng, key: `grid:${cell.taxon_id}:${cell.cell_x}:${cell.cell_y}`,
        kind: 'community',
      });
      byTaxon.set(cell.taxon_id, spots);
    }
    return byTaxon;
  }, [community]);
  const [me, setMe] = useState<LiveFix | null>(null);
  const [denied, setDenied] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [follow, setFollow] = useState(!showPublic);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<MapSpot | null>(null);
  const [clusterPins, setClusterPins] = useState<PhotoPin[] | null>(null);
  const [route, setRoute] = useState<{ from: LatLng; to: LatLng; path: LatLng[] | null; meters: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ to: LatLng; key: number; scale?: number; exact?: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  const [preview, setPreview] = useState(false);
  const [muted, setMuted] = useState(isRewardMuted);
  const [trackPts, setTrackPts] = useState<TrackPoint[]>([]);
  useEffect(() => {
    let alive = true;
    void locationPermission().then((permission) => {
      if (alive && permission === 'granted') setLocationEnabled(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 위치 권한을 받은 경우에만 지도가 열린 동안 걸어온 길을 기록합니다.
  useEffect(() => {
    if (!locationEnabled || showGuide) return;
    return watchPosition(
      (fix) => {
        setMe(fix);
        setDenied(false);
        if (inBounds(fix, content.park.bounds)) void appendFix(fix);
      },
      () => setDenied(true),
    );
  }, [locationEnabled, showGuide, content.park.bounds]);
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

  const seasonTaxa = useMemo(
    () => [...new Set([...season.todaySix, ...season.dex])].map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t),
    [content, season],
  );
  const found = useCallback((id: string) => !!dex?.foundIds.has(id), [dex]);

  const spotsFor = useCallback(
    (t: Taxon) => [...mapSpots(content, t, showPublic), ...(communityByTaxon.get(t.id) ?? [])],
    [content, showPublic, communityByTaxon],
  );
  const photoPins = useMemo<PhotoPin[]>(() => {
    const shown = new Set(showPublic ? [...publicTaxa.map((t) => t.id), ...communityByTaxon.keys()] : seasonTaxa.map((t) => t.id));
    if (selectedId) shown.add(selectedId);
    const pins: PhotoPin[] = [];
    for (const id of shown) {
      const t = taxonById(content, id);
      if (!t) continue;
      const isFound = found(t.id);
      const all = spotsFor(t);
      all.forEach(({ lat, lng, kind, key }, i) =>
        pins.push({ key: key ?? `${t.id}:${i}`, taxonId: t.id, lat, lng, label: t.koreanName, category: t.category, photo: t.photo?.src ?? null, kind, found: !showPublic && isFound }),
      );
    }
    return [...pins, ...mine];
  }, [content, publicTaxa, communityByTaxon, showPublic, seasonTaxa, selectedId, found, mine, spotsFor]);

  /** 종마다 내게서 가장 가까운 지점 */
  const nearest = useCallback(
    (t: Taxon, observationsOnly = false): { at: MapSpot; d: number | null } | null => {
      const all = spotsFor(t);
      const spots = observationsOnly ? all.filter((spot) =>
        (spot.kind === 'record' || spot.kind === 'community') && inBounds(spot, content.park.bounds)) : all;
      if (!spots.length) return null;
      if (!myFix) return { at: spots[0], d: null };
      return spots.filter((at) => at.kind !== 'area').map((at) => ({ at, d: distanceM(myFix, at) }))
        .sort((a, b) => a.d - b.d)[0] ?? { at: spots[0], d: null };
    },
    [content.park.bounds, myFix, spotsFor],
  );

  const select = useCallback(
    (id: string | null, pin?: PhotoPin) => {
      if (pin?.observationId) {
        navigate(`/records?focus=${pin.observationId}`);
        return;
      }
      setSelectedId(id);
      setClusterPins(null);
      setRoute(null);
      setHint(false);
      setNotice(null);
      if (id) setPreview(false);
      const t = taxonById(content, id);
      const clicked = t && pin && spotsFor(t).find((spot) => spot.kind === pin.kind && spot.lat === pin.lat && spot.lng === pin.lng);
      setSelectedSpot(clicked || null);
      const at = clicked || (t ? nearest(t)?.at : null);
      if (at) {
        setFollow(false);
        setFlyTo({ to: at, key: Date.now(), scale: 2 });
      }
    },
    [content, navigate, nearest, spotsFor],
  );

  const onClusterPick = (pins: PhotoPin[]) => {
    select(null);
    setFollow(false);
    setClusterPins(pins);
  };

  const onZoneClick = useCallback((id: string) => navigate(`/zone/${id}`), [navigate]);
  const onMapClick = useCallback(() => {
    setSelectedId(null);
    setSelectedSpot(null);
    setClusterPins(null);
    setRoute(null);
  }, []);
  const onUserMove = useCallback(() => setFollow(false), []);
  const focusPoint = content.map.focus ? { lat: content.map.focus[0], lng: content.map.focus[1] } : { lat: content.zones[0].center[0], lng: content.zones[0].center[1] };
  // 세로 화면에서도 호수 양쪽 산책로의 핀을 같은 화면에 담습니다.
  const overviewFocus = iso ? { lat: focusPoint.lat + 0.0005, lng: focusPoint.lng + 0.00087 } : focusPoint;
  const { lat: overviewLat, lng: overviewLng } = overviewFocus;
  const previousMode = useRef(showPublic);
  useEffect(() => {
    const modeChanged = previousMode.current !== showPublic;
    previousMode.current = showPublic;
    const focus = params.get('focus');
    if (focus) {
      select(focus);
      const remaining = new URLSearchParams(params);
      remaining.delete('focus');
      setParams(remaining, { replace: true });
    } else if (modeChanged && showPublic) {
      select(null);
      setFollow(false);
      setFlyTo({ to: { lat: overviewLat, lng: overviewLng }, key: Date.now(), scale: FOCUS_SCALE, exact: true });
    }
  }, [params, select, setParams, showPublic, overviewLat, overviewLng]);
  const scanZones = useMemo(() => content.zones.filter((zone) => zone.id !== 'Z6'), [content.zones]);
  const parkDistance = outside && me ? formatDistance(distanceM(me, focusPoint)) : null;

  const togglePreview = () => {
    if (preview) {
      setPreview(false);
      return;
    }
    select(null);
    setFollow(false);
    setPreview(true);
    setFlyTo({ to: overviewFocus, key: Date.now(), scale: FOCUS_SCALE, exact: true });
  };

  /** 하나뿐인 지도 버튼: 내 위치로 가서 따라가기 */
  const locate = async () => {
    if (denied) {
      setNotice('휴대폰 설정에서 위치 권한을 켜 주세요. 위치 없이도 지도와 기록은 쓸 수 있어요.');
      return;
    }
    const fix = myFix ?? (await getPosition());
    if (fix) setLocationEnabled(true);
    if (fix && inBounds(fix, content.park.bounds)) {
      if (!myFix) setMe({ ...fix, heading: null });
      setNotice(null);
      setPreview(false);
      setFollow(true);
      setFlyTo({ to: fix, key: Date.now(), scale: 2.5 });
    } else if (fix) {
      setMe({ ...fix, heading: null });
      if (!preview) togglePreview();
    } else setDenied(true);
  };

  const shoot = async (taxonId: string) => {
    await startDraft(taxonId);
    navigate('/record/photo');
  };

  const target = taxonById(content, selectedId);
  const targetSpot = target && selectedSpot?.key
    ? spotsFor(target).find((spot) => spot.key === selectedSpot.key) ?? nearest(target)?.at
    : selectedSpot ?? (target ? nearest(target)?.at : null);
  const access = targetSpot?.kind === 'record' ? snapToTrail(trails, targetSpot)?.point : targetSpot;
  const goWalk = () => {
    if (!target || !targetSpot || !canRouteTo(targetSpot) || !access) return;
    track('go_find', { taxonId: target.id });
    if (myFix) {
      const path = trails.pts.length ? routeOnTrail(trails, myFix, access) : null;
      if (!path && targetSpot.kind === 'record') {
        setNotice('이어지는 산책로를 찾지 못했어요. 지도에서 관찰 기록을 확인해 주세요.');
        return;
      }
      setRoute({ from: myFix, to: access, path, meters: path ? pathLength(path) : distanceM(myFix, access) });
      setFollow(false);
      setNotice(null);
    } else {
      setFlyTo({ to: targetSpot, key: Date.now(), scale: 3 });
      setNotice('공원 안에서 위치를 켜면 내 위치에서 가는 길을 보여 줘요.');
    }
  };

  const segments = useMemo(() => trackSegments(trackPts), [trackPts]);
  // 지금 걷는 곳은 버튼이 아니라 내 위치 점 아래 이름표로 보여 줍니다.
  const place = myFix ? describePlace(content, myFix) : null;
  const ranked = useMemo(() => seasonTaxa.map((taxon) => ({ taxon, spot: nearest(taxon, true) }))
    .sort((a, b) => Number(found(a.taxon.id)) - Number(found(b.taxon.id)) ||
      (a.spot?.d ?? Infinity) - (b.spot?.d ?? Infinity)), [seasonTaxa, found, nearest]);
  const recommendation = myFix ? ranked.find(({ taxon, spot }) => !found(taxon.id) && spot?.d != null) : undefined;
  const recommendedSpot = recommendation?.spot;
  const recommendedDistance = recommendedSpot?.d;
  const recommendedPin = recommendation && recommendedSpot ? photoPins.find((item) =>
    item.taxonId === recommendation.taxon.id && item.kind === recommendedSpot.at.kind &&
    item.lat === recommendedSpot.at.lat && item.lng === recommendedSpot.at.lng) : undefined;
  const nearby = recommendedDistance != null && recommendedDistance <= ALERT_M;
  const questEntry = dex?.completion ? '/dex/complete' : questMapUrl();
  const visibleClusters = clusterPins?.flatMap(({ key }) => {
    const pin = photoPins.find((item) => item.key === key);
    return pin ? [pin] : [];
  });

  const finishCoach = useCallback(
    (finished: boolean) => {
      if (finished || startingGuide) {
        navigate(questEntry, { replace: true });
        return;
      }
      const remaining = new URLSearchParams(params);
      remaining.delete('guide');
      setParams(remaining, { replace: true });
    },
    [navigate, params, questEntry, setParams, startingGuide],
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
          questPinKey={showPublic ? undefined : recommendedPin?.key}
          waterZone={preview ? zoneById(content, 'Z1') : undefined}
          scanZones={preview ? scanZones : null}
          onClusterPick={onClusterPick}
          openClustersOnClick={showPublic}
          selectedId={target?.id ?? null}
          onSpeciesClick={select}
          onMapClick={onMapClick}
          me={myFix}
          meLabel={place?.name}
          track={segments}
          follow={follow && !!myFix && !selectedId && !preview}
          onUserMove={onUserMove}
          route={route}
          routeLabel={route ? `도보 약 ${walkMinutes(route.meters)}분` : undefined}
          flyTo={flyTo}
          focus={overviewFocus}
          focusScale={FOCUS_SCALE}
          topInset={TOP_INSET}
          bottomInset={target || visibleClusters?.length ? BOTTOM_INSET_CARD : BOTTOM_INSET}
        />
      </div>

      <header className="hud-top">
        <div className="hud-overview">
          {showPublic ? (
            <h1 className="map-title">{content.park.name}</h1>
          ) : <div className={`next${nearby ? ' is-alert' : ''}`}>
            <div className="next__row">
              {recommendation && recommendedDistance != null ? (
                <button className="next__main" onClick={() => select(recommendation.taxon.id, recommendedPin)} aria-label={`${recommendation.taxon.koreanName} 지도에서 보기`}>
                  <span className="next__photo"><SpeciesArt taxon={recommendation.taxon} size="fill" /></span>
                  <span className="next__text">
                    <small>주변 관찰 추천 · 약 {formatDistance(recommendedDistance)}</small>
                    <strong>{recommendation.taxon.koreanName}</strong>
                  </span>
                </button>
              ) : dex?.completion ? (
                <Link to="/dex/complete" className="next__main">
                  <span className="next__badge"><Icon name="check" size={23} /></span>
                  <span className="next__text"><small>계절 퀘스트 완료</small><strong>완료 사진 보기</strong></span>
                </Link>
              ) : myFix ? (
                <Link to="/dex" className="next__main">
                  <span className="next__badge"><Icon name="book" size={23} /></span>
                  <span className="next__text"><small>{season.season} 관찰 후보</small><strong>도감에서 보기</strong></span>
                </Link>
              ) : (
                <button className="next__main" onClick={() => void locate()}>
                  <span className="next__badge"><Icon name="locate" size={23} /></span>
                  <span className="next__text"><small>{season.season} 관찰 후보</small><strong>내 위치로 추천받기</strong></span>
                </button>
              )}
            </div>
            <div className="next__progress">
              <progress max={seasonTaxa.length || 1} value={dex?.filled ?? 0} aria-label="계절 퀘스트 진행도" />
              <span>{dex?.filled ?? 0}/{seasonTaxa.length}</span>
            </div>
            <button className="next__scan" onClick={togglePreview} aria-pressed={preview} aria-label={parkDistance ? `공원 밖 ${parkDistance} · 레이더 미리보기` : '호수공원 레이더 미리보기'}>
              <span><Icon name="radar" size={16} />{preview ? '레이더 스캔 중' : parkDistance ? `공원 밖 · ${parkDistance}` : '공원 미리보기'}</span>
            </button>
          </div>}
          <div className="hud-tools">
            <button className="hud-tool hud-tool--sound" aria-label="효과음 음소거" aria-pressed={muted} onClick={() => { setRewardMuted(!muted); setMuted(!muted); }}>
              <Icon name={muted ? 'mute' : 'sound'} size={21} />
            </button>
            <button className={`hud-tool hud-tool--locate${follow && myFix ? ' is-on' : ''}`} onClick={() => void locate()} aria-label={denied ? '위치 권한 안내' : '내 위치로'} aria-pressed={follow && !!myFix}>
              <Icon name={denied ? 'question' : 'locate'} size={23} />
            </button>
            {content.map.attribution && <MapAttribution text={content.map.attribution} />}
          </div>
        </div>
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

      <section className="hud-bottom" aria-label={target ? `${target.koreanName} 찾기` : showPublic ? '공원 지도' : '계절 퀘스트'}>
        {publicTaxa.length > 0 && (
          <div className="map-record-controls">
            {!showPublic && <Link className="chip" to="/">전체 지도</Link>}
            {showPublic && <Link className="chip" to="/public-observations">관찰 종 목록</Link>}
          </div>
        )}
        {target ? (
          <FocusCard
            taxon={target}
            questMode={!showPublic}
            distance={route ? route.meters : access && myFix && canRouteTo(targetSpot) ? distanceM(myFix, access) : null}
            spot={targetSpot ?? undefined}
            routing={!!route}
            hint={hint}
            onHint={() => setHint((v) => !v)}
            onGo={goWalk}
            onShoot={() => void shoot(target.id)}
            onClose={() => select(null)}
          />
        ) : visibleClusters?.length ? (
          <ClusterTray pins={visibleClusters} onPick={select} onClose={() => setClusterPins(null)} />
        ) : showPublic ? (
          <section className="quest-invitation" aria-label="계절 퀘스트">
            <div>
              <h2>{season.season} 생물 도감{dex?.completion ? ' 완성!' : ''}</h2>
              <p>{dex?.completion ? '완료 사진을 현장에서 보여 주세요.' : dex?.filled
                ? `${dex.filled}/${dex.total}종을 찾았어요. 후보 중 원하는 생물을 골라요.`
                : '이번 계절에 찾아볼 수 있는 생물 중 원하는 종부터 찍어요.'}</p>
            </div>
            <Link to={dex?.filled ? questEntry : '/?guide=quest'} className="btn btn--primary btn--block">
              <Icon name={dex?.completion ? 'check' : 'binoculars'} size={20} />
              {dex?.completion ? '완료 사진 보기' : dex?.filled ? '퀘스트 이어 하기' : '퀘스트 시작해 보기'}
            </Link>
          </section>
        ) : (
          <SlotTray title={recommendation ? '이번 계절 · 주변 관찰 후보' : `${season.season} 관찰 후보`} count={dex?.filled ?? 0} total={seasonTaxa.length}
            taxa={ranked.map(({ taxon }) => taxon)} found={found} photos={mine} onPick={select} />
        )}
      </section>

      {showGuide && <Tour
        steps={EXPLORATION_GUIDE}
        label={startingGuide ? '퀘스트 안내' : '탐험 가이드'}
        finishLabel={dex?.completion ? '완료 사진 보기' : '관찰 후보 보기'}
        skipLabel={startingGuide ? '건너뛰고 시작' : undefined}
        onDone={finishCoach}
      />}
    </main>
  );
}

function ClusterTray({ pins, onPick, onClose }: {
  pins: PhotoPin[];
  onPick: (id: string, pin: PhotoPin) => void;
  onClose: () => void;
}) {
  const sorted = [...pins].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return (
    <div className="tray">
      <div className="tray__head">
        <h2>이곳의 관찰</h2>
        <button className="tray__close" onClick={onClose} aria-label="관찰 묶음 닫기">
          <Icon name="close" size={16} />
        </button>
      </div>
      <ul className="map-cluster-list" aria-label="이곳의 생물">
        {sorted.map((pin) => (
          <li key={pin.key}>
            <button className="chip" onClick={() => onPick(pin.taxonId, pin)}>
              <span className="map-cluster-list__photo">
                {pin.photo ? <img src={pin.photo} alt="" loading="lazy" decoding="async" /> : <CategoryIcon category={pin.category} size={20} />}
              </span>
              {pin.label}{pin.kind === 'mine' ? ' · 내 기록' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
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
function SlotTray({ title, count, total, taxa, found, photos, onPick }: {
  title: string;
  count?: number;
  total?: number;
  taxa: Taxon[];
  found: (id: string) => boolean;
  photos: PhotoPin[];
  onPick: (id: string) => void;
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
      </div>
      <ul className="tray__slots">
        {taxa.map((t) => {
          const collected = found(t.id);
          const photo = collected ? photos.find((pin) => pin.taxonId === t.id)?.photo : null;
          return (
            <li key={t.id}>
              <button className={`slot slot--${t.category}${collected ? ' is-found' : ''}`} onClick={() => onPick(t.id)} aria-label={`${t.koreanName}${collected ? ', 찾음' : ', 아직 못 찾음'}`}>
                {collected ? (
                  <>
                    {photo ? <img className="slot__photo" src={photo} alt="" decoding="async" /> : <SpeciesArt taxon={t} size="fill" />}
                    <span className="slot__check"><Icon name="check" size={10} /></span>
                  </>
                ) : t.photo ? <img className="slot__photo" src={t.photo.src} alt="" loading="lazy" /> : <CategoryIcon category={t.category} size={22} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 고른 생물: 무엇인지(사진·이름·어디) + 할 일 하나(찾으러 가기 → 찾았어요). 자세한 내용은 사진을 눌러 생물 카드에서 봅니다. */
function FocusCard({ taxon, questMode, distance, spot, routing, hint, onHint, onGo, onShoot, onClose }: {
  taxon: Taxon;
  questMode: boolean;
  distance: number | null;
  spot?: MapSpot;
  routing: boolean;
  hint: boolean;
  onHint: () => void;
  onGo: () => void;
  onShoot: () => void;
  onClose: () => void;
}) {
  const { content } = useContent();
  const referenceUrl = `/species/${taxon.id}${taxon.photo ? '?photo=reference' : ''}`;
  const canRoute = canRouteTo(spot);
  const showRouteButton = questMode && canRoute && !routing;
  return (
    <article className="focus">
      <button className="focus__close" onClick={onClose} aria-label="닫기">
        <Icon name="close" size={18} />
      </button>
      <div className="focus__main">
        <Link to={referenceUrl} className="focus__photo" aria-label={`${taxon.koreanName} ${taxon.photo ? '참고 사진 크게 보기' : '생물 카드'}`}>
          <SpeciesArt taxon={taxon} size="fill" />
        </Link>
        <div className="focus__text">
          <h3>
            <Link to={`/species/${taxon.id}`}>{taxon.koreanName}</Link>
          </h3>
          {taxon.photo && <Link to={referenceUrl} className="focus__reference">참고 사진 크게 보기</Link>}
          <p className="focus__meta">
            <Icon name="pin" size={15} />
            {spot?.label ?? (spot ? findZone(spot, content.zones)?.name : null) ?? zoneLabel(content, taxon)}
            {distance != null && <> · 걸어서 {walkMinutes(distance)}분</>}
          </p>
        </div>
      </div>
      <div className={`focus__actions${showRouteButton ? ' focus__actions--route' : ''}`}>
        {questMode || (canRoute && routing) ? (
          <button className="btn btn--primary focus__go" onClick={onShoot}>
            <Icon name="camera" size={22} /> {questMode ? '사진 찍기' : '찾았어요! 찍기'}
          </button>
        ) : canRoute ? (
          <button className="btn btn--primary focus__go" onClick={onGo}>
            <Icon name="walk" size={22} /> 찾으러 가기
          </button>
        ) : (
          <Link className="btn btn--primary focus__go" to={referenceUrl}>생물 카드 보기</Link>
        )}
        {showRouteButton && <button className="btn btn--secondary" onClick={onGo}>길 안내</button>}
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

/** 모든 개인 기록의 위치와 최근 40건의 사진을 표시합니다. */
function useMyPhotoPins(): PhotoPin[] {
  const { content } = useContent();
  const rows = useLiveQuery(async () => {
    const observations = (await db.observations.orderBy('createdAt').reverse().toArray())
      .filter((o) => !o.hidden && inBounds(o.subject, content.park.bounds));
    const photoIds = observations.slice(0, 40).flatMap((o) => o.photoIds.slice(0, 1));
    const photos = new Map((await db.photos.bulkGet(photoIds)).flatMap((p) => p ? [[p.id, p] as const] : []));
    return observations.map((obs) => {
      const photo = photos.get(obs.photoIds[0]);
      return { obs, blob: photo?.display ?? photo?.original ?? null };
    });
  }, [content.park.bounds]);
  const [pins, setPins] = useState<PhotoPin[]>([]);
  useEffect(() => {
    const urls: string[] = [];
    setPins(
      (rows ?? []).map(({ obs, blob }) => {
        const t = taxonById(content, obs.taxonId);
        let photo = t?.photo?.src ?? null;
        if (blob) {
          photo = URL.createObjectURL(blob);
          urls.push(photo);
        }
        return {
          key: `mine:${obs.id}`, observationId: obs.id, taxonId: t?.id ?? `unknown:${obs.id}`, ...obs.subject,
          label: t?.koreanName ?? '미확인 생물', category: t?.category ?? 'other', photo, kind: 'mine' as const, found: true,
        };
      }),
    );
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [rows, content]);
  return pins;
}
