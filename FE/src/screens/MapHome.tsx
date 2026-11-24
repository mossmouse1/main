import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CategoryIcon } from '../components/CategoryIcon';
import { Icon } from '../components/Icon';
import { ParkMap, type PhotoPin } from '../components/ParkMap';
import { SpeciesArt } from '../components/SpeciesArt';
import { useContent } from '../content/ContentProvider';
import { seasonContains, taxonById, zoneById } from '../content/helpers';
import type { Content, Taxon } from '../content/types';
import { Tour, type TourStep } from '../components/Tour';
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
    body: '이번 계절의 식물 8종과 흰뺨검둥오리·물닭을 찾아요. 지도 핀을 누르면 참고 사진과 관찰 지점을 볼 수 있어요.',
  },
  {
    target: () => document.querySelector('.dock__shoot-btn'),
    title: '공원에서 찍고 이름을 확인해요',
    body: '촬영 버튼을 눌러 사진을 찍고, 생물이 있던 곳과 이름을 확인하세요. ‘맞아요, 도감에 등록’을 누르면 사진이 저장돼요.',
  },
  {
    target: () => document.querySelector('.dock__dex'),
    title: '아래 도감에서 모은 종을 확인해요',
    body: '하단 ‘도감’의 ‘계절 퀘스트’에서 체크 표시가 붙은 칸을 확인하세요. 저장 화면에서는 다음 생물로 바로 이어갈 수 있어요.',
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
type MapSpot = LatLng & { kind: 'record' | 'area' | 'hint'; label?: string };

function mapSpots(content: Content, taxon: Taxon, publicOnly = false): MapSpot[] {
  const observations = taxon.publicObservations ?? [];
  const field = (content.fieldPhotos ?? []).flatMap((photo) => photo.taxonId === taxon.id && photo.location
    ? [{ ...photo.location, kind: 'record' as const, label: '조사팀 촬영 위치' }] : []);
  const points = [...field, ...observations.flatMap((record) => 'lat' in record ? [{ lat: record.lat, lng: record.lng, kind: 'record' as const }] : [])];
  if (points.length && !publicOnly) return points;
  const seenAreas = new Set<string | undefined>();
  const areas: MapSpot[] = [];
  for (const record of observations) {
    if (!('area' in record) || seenAreas.has(record.zoneId)) continue;
    seenAreas.add(record.zoneId);
    const at = zoneById(content, record.zoneId)?.center ?? content.map.focus;
    if (at) areas.push({ lat: at[0], lng: at[1], kind: 'area', label: record.area });
  }
  if (points.length || areas.length) return [...points, ...areas];
  return publicOnly ? [] : (taxon.sightings ?? []).filter((s) => s[2] === 0).map((s) => ({ ...toLatLng(s), kind: 'hint' }));
}

/**
 * S1 탐험(지도 홈). 쿼터뷰 블록 지도가 화면 전체를 채우고, 그 위에는 꼭 필요한 것만 둡니다.
 *
 * 위계(중요한 순서)
 * 1. 지도와 그 위의 ‘빈 칸’(못 찾은 생물) · ‘사진 딱지’(찾은 생물) — 무엇을 찾을지
 * 2. 아래 가운데 촬영 버튼(Layout의 아래쪽 버튼) — 찾았을 때 할 일
 * 3. 계절 퀘스트 칸 — 얼마나 채웠는지
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
  const guide = params.get('guide');
  const startingGuide = guide === 'quest';
  const showGuide = startingGuide || guide === '1';
  const fieldTaxa = useMemo(() => new Set((content.fieldPhotos ?? []).flatMap((photo) => photo.taxonId ? [photo.taxonId] : [])), [content]);
  const publicTaxa = useMemo(() => content.taxa.filter((taxon) => taxon.publicObservations?.length || fieldTaxa.has(taxon.id)), [content, fieldTaxa]);
  const showPublic = publicTaxa.length > 0 && params.get('public') !== '0';
  const publicRecords = useMemo(() => publicTaxa.flatMap((taxon) => taxon.publicObservations ?? []), [publicTaxa]);
  const pointCount = publicRecords.filter((record) => 'lat' in record).length;
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

  // 아직 못 찾은 생물의 공개 기록 지점이 바로 옆이면 알려 줍니다(오늘 6종이 아니어도).
  const alert = useMemo(() => {
    if (!myFix) return null;
    let best: { t: Taxon; d: number } | null = null;
    for (const t of seasonTaxa) {
      if (found(t.id)) continue;
      for (const spot of mapSpots(content, t)) {
        if (spot.kind !== 'record') continue;
        const d = distanceM(myFix, spot);
        if (d <= ALERT_M && (!best || d < best.d)) best = { t, d };
      }
    }
    return best;
  }, [content, myFix, seasonTaxa, found]);
  const alertId = alert?.t.id ?? null;

  /**
   * 공개 지도에는 모든 공개 기록을, 오늘의 6종 지도에는 탐험 대상과 우리 가족이 찍은 사진을 표시합니다.
   */
  const mine = useMyPhotoPins(season, !showPublic);
  const photoPins = useMemo<PhotoPin[]>(() => {
    const shown = new Set(showPublic ? publicTaxa.map((t) => t.id) : season.todaySix);
    if (selectedId) shown.add(selectedId);
    if (alertId) shown.add(alertId);
    const pins: PhotoPin[] = [];
    for (const id of shown) {
      const t = taxonById(content, id);
      if (!t) continue;
      const isFound = found(t.id);
      const all = mapSpots(content, t, showPublic);
      const spots = !showPublic && isFound && t.id !== selectedId ? (mine.some((p) => p.taxonId === t.id) ? [] : all.slice(0, 1)) : all;
      spots.forEach(({ lat, lng, kind }, i) =>
        pins.push({ key: `${t.id}:${i}`, taxonId: t.id, lat, lng, label: t.koreanName, category: t.category, photo: t.photo?.src ?? null, kind, found: !showPublic && isFound }),
      );
    }
    return showPublic ? pins : [...pins, ...mine];
  }, [content, publicTaxa, showPublic, season.todaySix, selectedId, alertId, found, mine]);

  /** 종마다 내게서 가장 가까운 지점 */
  const nearest = useCallback(
    (t: Taxon): { at: MapSpot; d: number | null } | null => {
      const spots = mapSpots(content, t, showPublic);
      if (!spots.length) return null;
      if (!myFix || spots[0].kind === 'area') return { at: spots[0], d: null };
      return spots.filter((at) => at.kind !== 'area').map((at) => ({ at, d: distanceM(myFix, at) })).sort((a, b) => a.d - b.d)[0];
    },
    [content, myFix, showPublic],
  );

  const select = useCallback(
    (id: string | null, pin?: PhotoPin) => {
      setSelectedId(id);
      setClusterPins(null);
      setRoute(null);
      setHint(false);
      setNotice(null);
      if (id) setPreview(false);
      const t = taxonById(content, id);
      const clicked = t && pin && mapSpots(content, t, showPublic).find((spot) => spot.kind === pin.kind && spot.lat === pin.lat && spot.lng === pin.lng);
      setSelectedSpot(clicked || null);
      const at = clicked || (t ? nearest(t)?.at : null);
      if (at) {
        setFollow(false);
        setFlyTo({ to: at, key: Date.now(), scale: 2 });
      }
    },
    [content, nearest, showPublic],
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
  const targetSpot = selectedSpot ?? (target ? nearest(target)?.at : null);
  const access = targetSpot?.kind === 'record' ? snapToTrail(trails, targetSpot)?.point : targetSpot;
  const goWalk = () => {
    if (!target || !targetSpot || targetSpot.kind === 'area' || !access) return;
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
  const sixTaxa = useMemo(() => season.todaySix.map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t), [content, season.todaySix]);
  const foundSix = sixTaxa.filter((t) => found(t.id)).length;

  // 위치가 있으면 가장 가까운 미수집 종, 없으면 오늘의 목록 첫 번째 종.
  const next = useMemo(() => {
    const left = sixTaxa.filter((t) => !found(t.id));
    if (!left.length) return null;
    const withD = left.map((t) => ({ t, spot: nearest(t) }));
    if (myFix) withD.sort((a, b) => (a.spot?.d ?? Infinity) - (b.spot?.d ?? Infinity));
    return withD[0];
  }, [sixTaxa, found, nearest, myFix]);
  const nearQuest = !showPublic && alert && alert.t.id !== selectedId ? alert : null;
  const quest = nearQuest ? { t: nearQuest.t, spot: nearest(nearQuest.t) } : next;
  const questSpot = quest?.spot?.at;
  const questPinKey = !showPublic && quest && questSpot ? photoPins.find((pin) => pin.taxonId === quest.t.id && pin.lat === questSpot.lat && pin.lng === questSpot.lng)?.key : undefined;
  const questEntry = dex?.completion ? '/dex/complete' : questMapUrl(dex?.nextClue ?? next?.t);

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
          questPinKey={questPinKey}
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
          bottomInset={target || clusterPins ? BOTTOM_INSET_CARD : BOTTOM_INSET}
        />
      </div>

      <header className="hud-top">
        <div className="hud-overview">
          {showPublic ? (
            <div className="next public-map-summary">
              <strong>{content.park.name}</strong>
              <p>{publicTaxa.length}종 · 좌표 {pointCount}건 · 구역 {publicRecords.length - pointCount}건</p>
              {fieldTaxa.size > 0 && <p>조사팀 현장 사진 {fieldTaxa.size}종</p>}
            </div>
          ) : <div className={`next${nearQuest ? ' is-alert' : ''}`}>
            <div className="next__row">
              {quest ? (
                <button className="next__main" onClick={() => select(quest.t.id)} aria-label={`${quest.t.koreanName} 지도에서 보기`}>
                  <span className="next__photo"><SpeciesArt taxon={quest.t} size="fill" /></span>
                  <span className="next__text">
                    <small>{nearQuest ? '근처에서 관찰된 생물' : '다음에 찾을 생물'}</small>
                    <strong>{quest.t.koreanName}</strong>
                  </span>
                </button>
              ) : (
                <Link to={dex?.completion ? '/dex/complete' : '/dex'} className="next__main">
                  <span className="next__badge"><Icon name="check" size={23} /></span>
                  <span className="next__text"><small>계절 퀘스트 완료</small><strong>{dex?.completion ? '완료 사진 보기' : '도감 열기'}</strong></span>
                </Link>
              )}
              {nearQuest && <button className="next__act" onClick={() => void shoot(nearQuest.t.id)} aria-label={`${nearQuest.t.koreanName} 촬영`}><Icon name="viewfinder" size={22} /></button>}
            </div>
            <div className="next__progress">
              <progress max={sixTaxa.length || 1} value={foundSix} aria-label="계절 퀘스트 진행도" />
              <span>{foundSix}/{sixTaxa.length}</span>
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

      <section className="hud-bottom" aria-label={target ? `${target.koreanName} 찾기` : showPublic ? '공개 관찰 지도' : '계절 퀘스트'}>
        {content.map.attribution && <p className="hud-credit">{content.map.attribution}</p>}
        {publicTaxa.length > 0 && (
          <div className="map-record-controls">
            {!showPublic && <Link className="chip" to="/">전체 지도</Link>}
            {showPublic && <Link className="chip" to="/public-observations">관찰 종 목록</Link>}
          </div>
        )}
        {target ? (
          <FocusCard
            taxon={target}
            found={found(target.id)}
            questMode={!showPublic}
            distance={route ? route.meters : access && myFix && targetSpot?.kind !== 'area' ? distanceM(myFix, access) : null}
            spot={targetSpot ?? undefined}
            routing={!!route}
            hint={hint}
            onHint={() => setHint((v) => !v)}
            onGo={goWalk}
            onShoot={() => void shoot(target.id)}
            onClose={() => select(null)}
          />
        ) : clusterPins ? (
          <ClusterTray pins={clusterPins} onPick={select} onClose={() => setClusterPins(null)} />
        ) : showPublic ? (
          <section className="quest-invitation" aria-label="계절 퀘스트">
            <div>
              <h2>{season.season} 생물 도감{dex?.completion ? ' 완성!' : ''}</h2>
              <p>{dex?.completion ? '완료 사진을 현장에서 보여 주세요.' : dex?.filled
                ? `${dex.filled}/${dex.total}종을 찾았어요. 다음 생물을 만나러 가요.`
                : '공원에서 식물 8종과 물새 2종을 찍고 도감을 채워요.'}</p>
            </div>
            <Link to={dex?.filled ? questEntry : '/?guide=quest'} className="btn btn--primary btn--block">
              <Icon name={dex?.completion ? 'check' : 'binoculars'} size={20} />
              {dex?.completion ? '완료 사진 보기' : dex?.filled ? '퀘스트 이어 하기' : '퀘스트 시작해 보기'}
            </Link>
          </section>
        ) : (
          <SlotTray title={`${season.season} 퀘스트`} count={foundSix} total={sixTaxa.length} taxa={sixTaxa} found={found} photos={mine} onPick={select} />
        )}
      </section>

      {showGuide && <Tour
        steps={EXPLORATION_GUIDE}
        label={startingGuide ? '퀘스트 안내' : '탐험 가이드'}
        finishLabel={dex?.completion ? '완료 사진 보기' : '첫 생물 찾기'}
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
        <h2>이곳의 생물 {pins.length}종</h2>
        <button className="tray__close" onClick={onClose} aria-label="관찰 묶음 닫기">
          <Icon name="close" size={16} />
        </button>
      </div>
      <ul className="map-cluster-list" aria-label="이곳의 생물">
        {sorted.map((pin) => (
          <li key={pin.taxonId}>
            <button className="chip" onClick={() => onPick(pin.taxonId, pin)}>
              <span className="map-cluster-list__photo">
                {pin.photo ? <img src={pin.photo} alt="" loading="lazy" decoding="async" /> : <CategoryIcon category={pin.category} size={20} />}
              </span>
              {pin.label}
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
function FocusCard({ taxon, found, questMode, distance, spot, routing, hint, onHint, onGo, onShoot, onClose }: {
  taxon: Taxon;
  found: boolean;
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
  const canRoute = !!spot && spot.kind !== 'area';
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
          <p className="kicker">{spot?.kind === 'area' ? '구역 기록' : spot?.kind === 'record' ? '공개 관찰 지점' : found ? '우리 가족이 찾은 생물' : '찾아볼 생물'}</p>
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
          <Link className="btn btn--primary focus__go" to={referenceUrl}>관찰 자료 보기</Link>
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

/** 우리 가족이 이번 계절에 찍은 사진을 찍은 자리에 딱지로(가장 최근 40장) */
function useMyPhotoPins(season: ReturnType<typeof useSeason>, enabled: boolean): PhotoPin[] {
  const { content } = useContent();
  const rows = useLiveQuery(async () => {
    if (!enabled) return [];
    const obs = (await db.observations.orderBy('createdAt').reverse().toArray()).filter((o) => !o.hidden && o.taxonId && seasonContains(season, o.observedAt)).slice(0, 40);
    return Promise.all(
      obs.map(async (o) => {
        const photo = o.photoIds[0] ? await db.photos.get(o.photoIds[0]) : undefined;
        return { obs: o, blob: photo?.display ?? photo?.original ?? null };
      }),
    );
  }, [enabled, season.id]);
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
