import { visibleIdentifyCandidates } from '@shared/identify';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { BlobImage } from '../components/Layout';
import { MapAttribution } from '../components/MapAttribution';
import { ParkMap } from '../components/ParkMap';
import { markRecordReward } from '../components/RecordReward';
import { SpeciesArt } from '../components/SpeciesArt';
import { BACKEND_MODE, DEFAULT_RADIUS, MAX_PHOTOS, RADIUS_CHOICES } from '../config';
import { useContent } from '../content/ContentProvider';
import { candidatesFromTaxon, candidatesFromZone, searchTaxa, taxonById } from '../content/helpers';
import { CATEGORY_LABEL, type Content, type SeasonSet, type Taxon } from '../content/types';
import { db, getMeta, setMeta } from '../data/db';
import { addPhotos, discardDraft, pickTaxon, removePhoto, setObserver, startDraft, updateDraft } from '../data/draft';
import { usePhotoIdentification } from '../data/identify';
import { saveObservation } from '../data/observations';
import { track } from '../data/track';
import type { LocationMethod, MediaSource, PickSource, RecordDraft } from '../data/types';
import { useSeason } from '../hooks';
import { DEBUG, debugInc, debugSet } from '../lib/debug';
import { usePinchZoom } from '../lib/usePinchZoom';
import { clampZoom, zoomLimits } from '../lib/zoom';
import { playRewardAudio, prepareRewardAudio } from '../lib/rewardAudio';
import { withEul } from '../lib/josa';
import { distanceM, findZone, formatDistance, inBounds, type LatLng } from '../lib/geo';
import { captureFrame, getPosition, hardwareZoomRange, openCameraStream, pickPhotos, setHardwareZoom, stopStream, type Facing } from '../platform';

/** undefined = 읽는 중, null = 기록 중이 아님 */
function useDraft(): RecordDraft | null | undefined {
  return useLiveQuery(async () => ({ d: (await db.drafts.get('current')) ?? null }), [])?.d;
}

/** 기록 화면 머리글: 뒤로 · 제목 · 도움말(기록 그만두기 포함) */
function RecordTop({ title, sub, onBack, help, dark = false }: { title: string; sub?: string; onBack: () => void; help: ReactNode; dark?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className={`record-top${dark ? ' is-dark' : ''}`}>
        <button className="icon-btn" onClick={onBack} aria-label="이전 단계">
          <Icon name="back" size={26} />
        </button>
        <div className="record-top__title">
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="도움말">
          <Icon name="question" size={28} />
        </button>
      </header>
      {open && (
        <div className="help-sheet" role="dialog" aria-modal="true" aria-label="도움말">
          <button className="help-sheet__scrim" onClick={() => setOpen(false)} aria-label="닫기" />
          <div className="help-sheet__body">
            <span className="sheet-handle" aria-hidden="true" />
            <div className="help-sheet__text">{help}</div>
            <p className="notice notice--soft">
              <Icon name="shield" size={18} /> 사람 얼굴이 나오지 않게 찍어 주세요.
            </p>
            <button className="btn btn--primary btn--block" onClick={() => setOpen(false)}>
              계속하기
            </button>
            <button
              className="btn btn--text btn--block"
              onClick={async () => {
                await discardDraft();
                navigate('/', { replace: true });
              }}
            >
              기록 그만두기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** S4 촬영: 화면 안 카메라(1×·2×, 전환) 또는 휴대폰 카메라·앨범. 고른 사진은 바로 기기에 저장합니다. */
export function RecordPhoto() {
  const draft = useDraft();
  const { content } = useContent();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // then=pick: 확인 화면에서 ‘다시 찍기’·‘사진 추가’로 왔을 때(replace=1이면 찍은 사진을 바꿈)
  const backToPick = params.get('then') === 'pick';
  const replace = params.get('replace') === '1';
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [cam, setCam] = useState<'starting' | 'live' | 'off'>('starting');
  // 배율은 ref에 두고 requestAnimationFrame으로 영상에 바로 반영합니다(핀치 중 재렌더 없음). zoomLabel은 표시·버튼용으로 천천히 갱신합니다.
  const [zoomLabel, setZoomLabel] = useState(1);
  const [view, setView] = useState<HTMLDivElement | null>(null); // 콜백 ref: 요소가 늦게 나타나도 핀치 리스너가 달리게
  const zoomRef = useRef(1);
  const hwRef = useRef<{ min: number; max: number } | null>(null);
  const facingRef = useRef<Facing>('environment');
  const raf = useRef(0);
  const labelAt = useRef(0);
  const trail = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hwBusy = useRef(false);
  const hwTarget = useRef<number | null>(null);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null);

  const paint = useCallback(() => {
    raf.current = 0;
    const z = zoomRef.current;
    const mirror = facingRef.current === 'user' ? ' scaleX(-1)' : '';
    // 하드웨어 줌이 없으면 CSS로 가운데를 확대(디지털 줌). 있으면 영상 자체가 확대돼서 옵니다.
    if (video.current) video.current.style.transform = !hwRef.current && z > 1 ? `scale(${z})${mirror}` : '';
    debugInc('zoom.updates');
    const publish = () => {
      setZoomLabel(zoomRef.current);
      debugSet('zoom.value', Number(zoomRef.current.toFixed(2)));
    };
    if (performance.now() - labelAt.current > 100) {
      labelAt.current = performance.now();
      publish();
    }
    clearTimeout(trail.current);
    trail.current = setTimeout(publish, 120); // 손가락을 뗀 뒤 마지막 값을 반드시 표시
  }, []);

  // 하드웨어 줌: 진행 중인 호출이 있으면 최신 목표값만 기억했다가 끝나면 그 값만 적용합니다(큐에 쌓아 밀리지 않게).
  const pushHw = useCallback(() => {
    const s = stream.current;
    const target = hwTarget.current;
    if (hwBusy.current || !s || target === null) return;
    hwTarget.current = null;
    hwBusy.current = true;
    void setHardwareZoom(s, target).finally(() => {
      hwBusy.current = false;
      if (hwTarget.current !== null) pushHw();
    });
  }, []);

  const setZoom = useCallback(
    (z: number) => {
      zoomRef.current = z;
      if (!raf.current) raf.current = requestAnimationFrame(paint);
      const hw = hwRef.current;
      if (hw) {
        hwTarget.current = clampZoom(z, hw.min, hw.max);
        pushHw();
      }
    },
    [paint, pushHw],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(trail.current);
    },
    [],
  );
  const [busy, setBusy] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [tip, setTip] = useState(false);
  const [flash, setFlash] = useState(false);
  const askedPosition = useRef<string | null>(null);

  useEffect(() => {
    if (draft === null) void startDraft(null);
  }, [draft]);

  // 촬영자 위치는 기록을 시작할 때 한 번 읽습니다.
  useEffect(() => {
    if (!draft || draft.observer || askedPosition.current === draft.draftId) return;
    const { draftId } = draft;
    askedPosition.current = draftId;
    void getPosition().then((fix) => fix && setObserver(draftId, fix));
  }, [draft]);

  useEffect(() => {
    void getMeta('cameraTipSeen').then((seen) => !seen && setTip(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCam('starting');
    facingRef.current = facing;
    void openCameraStream(facing).then((s) => {
      if (cancelled) return stopStream(s);
      if (!s) return setCam('off');
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        void video.current.play().catch(() => {});
      }
      const hw = hardwareZoomRange(s);
      hwRef.current = hw;
      setHwZoom(hw);
      debugSet('zoom.mode', hw ? 'hardware' : 'digital');
      debugSet('zoom.hwRange', hw ? `${hw.min}-${hw.max}` : 'none');
      setZoom(1);
      setCam('live');
    });
    return () => {
      cancelled = true;
      stopStream(stream.current);
      stream.current = null;
    };
  }, [facing]);

  const limits = zoomLimits(hwZoom);
  usePinchZoom(view, () => zoomRef.current, setZoom, limits.min, limits.max);
  useEffect(() => {
    if (!DEBUG) return;
    const caps = (s: MediaStream | null) => (s?.getVideoTracks()[0]?.getCapabilities?.() as { zoom?: unknown } | undefined)?.zoom;
    debugSet('zoom.capsZoom', caps(stream.current) ? 'yes' : 'no');
  }, [cam]);

  if (!draft) return null;
  const room = replace ? MAX_PHOTOS : MAX_PHOTOS - draft.photos.length;
  const target = taxonById(content, draft.sourceTaxonId);
  const last = draft.photos[draft.photos.length - 1];

  const goNext = () => navigate(draft.subject ? '/record/pick' : '/record/where', { replace: backToPick });

  const add = async (files: File[], source: MediaSource) => {
    if (!files.length) return;
    setBusy(true);
    setPhotoFailed(false);
    try {
      const added = await addPhotos(files, source, replace);
      if (!added) {
        setPhotoFailed(true);
        return;
      }
      track('record_photo', { draftId: draft.draftId, photos: (replace ? 0 : draft.photos.length) + added, source });
      goNext();
    } catch {
      setPhotoFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (busy) return;
    if (room <= 0) return goNext();
    if (cam === 'live' && video.current) {
      setFlash(true);
      setTimeout(() => setFlash(false), 160);
      const file = await captureFrame(video.current, hwZoom ? 1 : zoomRef.current);
      if (file) return add([file], 'camera');
    }
    // 화면 안 카메라를 못 쓰면 휴대폰 카메라 앱(PRD F05 기본). 사용자 탭 안에서 바로 열어야 합니다.
    void pickPhotos('camera', room).then((files) => add(files, 'camera'));
  };

  const back = async () => {
    if (backToPick) return navigate('/record/pick', { replace: true });
    if (!draft.photos.length) await discardDraft();
    navigate('/', { replace: true });
  };

  return (
    <main className="camera">
      <RecordTop
        dark
        title="생물 촬영"
        onBack={() => void back()}
        help={
          <>
            <h2>이렇게 찍어요</h2>
            <ul className="dot-list">
              <li>생물이 화면 가운데 오게 맞춰요.</li>
              <li>멀리 있으면 2×로 확대해서 찍어요.</li>
              <li>사진은 1장 꼭, 3장까지 남길 수 있어요.</li>
            </ul>
          </>
        }
      />
      <div ref={setView} className={`camera__view${cam === 'live' ? ' is-live' : ''}`}>
        <video
          ref={video}
          className={`camera__video${facing === 'user' ? ' is-mirror' : ''}`}
          playsInline
          muted
          autoPlay
          aria-hidden="true"
        />
        <div className="camera__overlay">
          <p className="camera__face">
            <Icon name="shield" size={16} /> 사람 얼굴이 나오지 않게 찍어요
          </p>
          <div className="camera__frame">
            {cam === 'starting' && <p className="camera__status">카메라를 켜는 중…</p>}
            {cam === 'off' && (
              <div className="camera__fallback">
                <Icon name="camera" size={44} />
                <strong>촬영 버튼을 누르면 휴대폰 카메라가 열려요</strong>
                <span>이 브라우저에서는 화면 안 미리보기를 쓸 수 없어요</span>
              </div>
            )}
          </div>
          {tip && (
            <div className="camera-tip" role="note">
              <span className="camera-tip__badge">처음 촬영하시나요?</span>
              <strong>생물이 화면 가운데 오도록 맞춰주세요</strong>
              <span>흐리지 않게 한 장 찍어주세요</span>
              <button
                className="btn btn--pill"
                onClick={() => {
                  setTip(false);
                  void setMeta('cameraTipSeen', true);
                }}
              >
                알겠어요
              </button>
            </div>
          )}
          {cam === 'live' && (
            <div className="zoom">
              <p>멀리 있다면 확대해서 찍어보세요</p>
              <div className="zoom__seg" role="group" aria-label="확대">
                {([1, 2] as const).map((z) => (
                  <button key={z} className={Math.abs(zoomLabel - z) < 0.05 ? 'is-on' : ''} aria-pressed={Math.abs(zoomLabel - z) < 0.05} onClick={() => {
                      const c = clampZoom(z, limits.min, limits.max);
                      setZoom(c);
                      setZoomLabel(c);
                    }}>
                    {z}×
                  </button>
                ))}
                <output className="zoom__value" aria-live="off">{zoomLabel.toFixed(1)}×</output>
              </div>
            </div>
          )}
        </div>
        {draft.photos.length > 0 && !replace && (
          <button className="camera__count" onClick={goNext}>
            찍은 사진 {draft.photos.length}장 · 다음 <Icon name="chevron" size={16} />
          </button>
        )}
        {flash && <span className="camera__flash" aria-hidden="true" />}
      </div>
      <div className="camera__controls">
        <button
          className="cam-side"
          disabled={busy || room <= 0}
          onClick={() => void pickPhotos('album', room).then((files) => add(files, 'album'))}
        >
          <span className="cam-side__thumb">{last && !replace ? <BlobImage blob={last.display ?? last.original} alt="" /> : <Icon name="image" size={26} />}</span>
          <span>앨범</span>
        </button>
        <button className="shutter" onClick={() => void shoot()} disabled={busy} aria-label="촬영">
          <span className="shutter__ring" aria-hidden="true" />
          <span>촬영</span>
        </button>
        <button className="cam-side" disabled={cam !== 'live' || busy} onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>
          <span className="cam-side__icon">
            <Icon name="flip" size={30} />
          </span>
          <span>전환</span>
        </button>
      </div>
      <p className="camera__foot" role="status">
        {busy ? '사진을 저장하는 중…' : photoFailed ? '사진을 저장하지 못했어요. 다시 찍거나 앨범에서 골라 주세요.' : BACKEND_MODE === 'supabase'
          ? '사진의 위치 정보를 지운 사본을 OpenAI로 보내 생물 이름을 찾습니다.'
          : target ? `${withEul(target.koreanName)} 찍고 이름을 확인해요` : '촬영 후 생물 이름을 확인하고 등록해요'}
      </p>
    </main>
  );
}

/** 촬영 위치를 기본으로 쓰고, 지도에서 생물이 있던 곳을 따로 고를 수 있습니다. */
export function RecordWhere() {
  const draft = useDraft();
  const { content, mapUrl, isoUrl } = useContent();
  const iso = isoUrl ? content.map.iso ?? null : null;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = params.get('then') === 'pick';
  const [selection, setSelection] = useState<{ subject: LatLng; method: LocationMethod }>();
  const [selectedRadius, setSelectedRadius] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const identification = usePhotoIdentification(draft?.photos[0]);
  const likelyName = identifiedCandidates(content, identification.result)[0]?.koreanName;

  if (draft === undefined) return null;
  if (draft === null) return <Navigate to="/" replace />;
  if (!draft.photos.length) return <Navigate to="/record/photo" replace />;

  const observer = draft.observer;
  const observerInPark = !!observer && inBounds(observer, content.park.bounds);
  const subject = selection?.subject ?? draft.subject ?? observer;
  const method = selection?.method ?? draft.locationMethod ?? (observer ? 'near_me' : 'tap');
  const nearMe = method === 'near_me';
  const radius = selectedRadius ?? draft.radiusM ?? DEFAULT_RADIUS;
  const effectiveRadius = nearMe && observer ? Math.min(5000, Math.max(radius, observer.accuracy)) : radius;
  const zone = subject ? findZone(subject, content.zones) : null;

  const distanceText = nearMe
    ? '촬영 위치 기준'
    : !subject
      ? '지도를 눌러 주세요'
      : observer
        ? `찍은 곳에서 ${formatDistance(distanceM(observer, subject))}`
        : '찍은 곳 위치를 알 수 없어요';

  const confirm = async () => {
    if (!subject || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateDraft({ subject: { lat: subject.lat, lng: subject.lng }, radiusM: effectiveRadius, locationMethod: method });
      navigate('/record/pick', { replace: editing });
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  };

  return (
    <main className="record record--map">
      <RecordTop
        title="있던 곳"
        onBack={() => navigate(editing ? '/record/pick' : '/record/photo', { replace: true })}
        help={
          <>
            <h2>생물이 있던 곳을 눌러요</h2>
            <p>촬영 위치에서 바로 반경을 고를 수 있어요. 생물이 다른 곳에 있었다면 지도에서 그곳을 눌러 주세요.</p>
          </>
        }
      />
      <p className="record__hint" role="status">
        {likelyName ? <><strong>AI 추정 · {likelyName}</strong><br /></> : identification.pending ? <>AI가 사진 속 생물을 살펴보는 중이에요.<br /></> : null}
        {subject ? '반경을 고르거나 지도에서 위치를 조정해 주세요.' : '촬영 위치를 쓸 수 없으면 지도에서 생물이 있던 곳을 눌러 주세요.'}
      </p>
      <div className="record__map">
        {/* 지도 홈과 같은 블록 지도. 누른 곳은 그 뒤 땅의 자리로 정합니다(나무·건물 위를 눌러도). */}
        <ParkMap
          imageUrl={iso ? isoUrl! : mapUrl}
          iso={iso}
          bounds={content.park.bounds}
          scale
          zones={content.zones}
          facilities={content.facilities}
          me={observerInPark ? observer : null}
          meLabel="찍은 곳"
          subject={subject ?? null}
          radiusM={effectiveRadius}
          focus={subject && inBounds(subject, content.park.bounds) ? subject : null}
          focusScale={iso ? 2.6 : 2.5}
          flyTo={observerInPark && nearMe && observer ? { to: observer, key: Date.parse(observer.at), scale: 2.5 } : null}
          onMapClick={(p) => setSelection({ subject: p, method: 'tap' })}
        />
        {content.map.attribution && <MapAttribution text={content.map.attribution} />}
      </div>
      <div className="where-panel">
        <div className="row row--between">
          <div className="where-panel__text">
            <strong aria-live="polite">{distanceText}</strong>
            {subject && !inBounds(subject, content.park.bounds)
              ? <span className="muted">공원 밖</span>
              : zone && <span className="muted">{zone.name}</span>}
          </div>
          <button
            className={`chip${nearMe ? ' is-on' : ''}`}
            aria-pressed={nearMe}
            disabled={!observer}
            onClick={() => observer && setSelection({ subject: observer, method: 'near_me' })}
          >
            촬영 위치 사용
          </button>
        </div>
        <div className="row row--tight" role="group" aria-label="반경">
          <span className="muted">반경</span>
          {RADIUS_CHOICES.map((r) => (
            <button key={r} className={`chip${radius === r ? ' is-on' : ''}`} aria-pressed={radius === r} onClick={() => setSelectedRadius(r)}>
              {r}m
            </button>
          ))}
        </div>
        {effectiveRadius > radius && <p className="caption">GPS 오차를 포함해 반경 {effectiveRadius}m로 저장해요.</p>}
        {saveFailed && <p className="caption" role="alert">위치를 저장하지 못했어요. 다시 눌러 주세요.</p>}
        <button className="btn btn--primary btn--block btn--big" disabled={!subject || saving} onClick={() => void confirm()}>
          {saving ? '저장 중…' : editing ? '이 위치로 정하기' : '다음 · 이름 확인'}
        </button>
      </div>
    </main>
  );
}

type Choice = { taxonId: string | null; source: PickSource; freeText: string | null; candidateIds?: string[] };

async function saveWith(content: Content, season: SeasonSet, draft: RecordDraft, choice: Choice) {
  await pickTaxon(choice.taxonId, choice.source, choice.freeText);
  return saveObservation(
    content,
    { ...draft, taxonId: choice.taxonId, pickSource: choice.source, freeTextName: choice.freeText, candidateIds: choice.candidateIds ?? draft.candidateIds },
    { subject: draft.subject!, radiusM: draft.radiusM ?? DEFAULT_RADIUS, method: draft.locationMethod ?? 'tap' },
    season,
  );
}

/** 사진 카드: 찍은 사진, 다시 찍기, 사진 추가(최대 3장) */
function ShotCard({ draft, photo, onSelect }: { draft: RecordDraft; photo: RecordDraft['photos'][number]; onSelect: (id: string | null) => void }) {
  const navigate = useNavigate();
  return (
    <div className="shot">
      <div className="shot__photo">
        <BlobImage blob={photo.display ?? photo.original} alt="찍은 사진" failText="사진을 불러오지 못했어요. 다시 찍기" diag />
        <span className="shot__badge">
          <Icon name="camera" size={18} /> 촬영한 사진
        </span>
        <button className="shot__retake" onClick={() => navigate('/record/photo?then=pick&replace=1')}>
          <Icon name="refresh" size={20} /> 다시 찍기
        </button>
      </div>
      {(draft.photos.length > 1 || draft.photos.length < MAX_PHOTOS) && (
        <ul className="shot__thumbs" aria-label="찍은 사진">
          {draft.photos.length > 1 &&
            draft.photos.map((p, i) => (
              <li key={p.id}>
                <button className={`shot__thumb${p.id === photo.id ? ' is-on' : ''}`} onClick={() => onSelect(p.id)} aria-label={`사진 ${i + 1} 보기`} aria-pressed={p.id === photo.id}>
                  <BlobImage blob={p.display ?? p.original} alt="" />
                </button>
                <button className="shot__remove" onClick={() => void removePhoto(p.id).then(() => { if (p.id === photo.id) onSelect(null); })} aria-label={`사진 ${i + 1} 지우기`}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          {draft.photos.length < MAX_PHOTOS && (
            <li>
              <button className="shot__add" onClick={() => navigate('/record/photo?then=pick')}>
                <Icon name="plus" size={20} /> 사진 추가
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** 관찰 위치 줄(있던 곳 요약 + 수정) */
function WhereRow({ draft, editable = true }: { draft: RecordDraft; editable?: boolean }) {
  const { content } = useContent();
  const subject = draft.subject;
  const zone = subject ? findZone(subject, content.zones) : null;
  const outside = !!subject && !inBounds(subject, content.park.bounds);
  const detail =
    draft.locationMethod === 'near_me'
      ? '찍은 곳 근처'
      : subject && draft.observer
        ? `찍은 곳에서 ${formatDistance(distanceM(draft.observer, subject))}`
        : `반경 ${draft.radiusM ?? DEFAULT_RADIUS}m`;
  return (
    <div className="where-row">
      <Icon name="pin" size={22} />
      <strong>관찰 위치</strong>
      <span className="where-row__text">
        {outside ? '공원 밖' : (zone?.name ?? '조사구역 밖')} · {detail}
      </span>
      {editable && <Link to="/record/where?then=pick">수정</Link>}
    </div>
  );
}


const IDENTIFY_ERROR_TEXT: Record<string, string> = {
  rate_limited: '잠깐 쉬었다가 다시 눌러 주세요. 1분에 5번까지 추천받을 수 있어요.',
  daily_limit: '오늘 추천받을 수 있는 횟수를 다 썼어요. 이름은 직접 찾아 주세요.',
  global_limit: '오늘은 추천 기능이 많이 쓰여서 잠시 쉬어요. 이름은 직접 찾아 주세요.',
  consent_required: '동의를 먼저 마쳐야 추천받을 수 있어요.',
  unavailable: '사진 추천 서버를 아직 사용할 수 없어요. 이름은 직접 찾을 수 있어요.',
  too_large: '사진이 너무 커요. 다른 사진을 골라 주세요.',
  invalid_image: '이 사진을 읽지 못했어요. 다시 찍거나 다른 사진을 골라 주세요.',
  network: '인터넷 연결을 확인하고 다시 눌러 주세요.',
};
function identifiedCandidates(content: Content, result: ReturnType<typeof usePhotoIdentification>['result']): Taxon[] {
  return visibleIdentifyCandidates(result, (id) => !!taxonById(content, id))
    .map(({ taxonId }) => taxonById(content, taxonId)!);
}

/** 자동으로 찾은 후보를 확인하고 이름을 직접 찾거나 미확인으로 저장합니다. */
export function RecordPick() {
  const draft = useDraft();
  const { content } = useContent();
  const season = useSeason();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const photo = draft?.photos.find((item) => item.id === selectedPhotoId) ?? draft?.photos[0];
  const identification = usePhotoIdentification(photo);

  if (draft === undefined) return null;
  if (draft === null) return <Navigate to="/" replace />;
  if (!photo) return <Navigate to="/record/photo" replace />;
  if (!draft.subject) return <Navigate to="/record/where" replace />;
  const aiTaxa = identifiedCandidates(content, identification.result);
  const aiIds = aiTaxa.map((taxon) => taxon.id);
  const zone = findZone(draft.subject, content.zones);
  const candidateSource: PickSource = draft.sourceTaxonId ? 'card' : 'zone';
  const localIds = draft.sourceTaxonId
    ? candidatesFromTaxon(content, draft.sourceTaxonId, draft.draftId)
    : candidatesFromZone(content, zone?.id ?? null, season, draft.draftId);
  const current: Choice | null = choice ?? (aiIds.length ? { taxonId: aiIds[0], source: 'photo_ai', freeText: null, candidateIds: aiIds } : null);
  const taxon = taxonById(content, current?.taxonId);
  const name = taxon?.koreanName ?? current?.freeText;
  const alternatives = (aiIds.length ? aiIds : localIds).filter((id) => id !== current?.taxonId);
  const results = query.trim() ? searchTaxa(content, query) : season.dex.map((id) => taxonById(content, id)).filter((t): t is Taxon => !!t);

  const confirm = async () => {
    if (!current || saving) return;
    setSaving(true);
    setSaveFailed(false);
    const audio = prepareRewardAudio();
    try {
      const { observation, reward } = await saveWith(content, season, draft, current);
      if (reward) {
        markRecordReward(observation.id, reward);
        void playRewardAudio(audio, reward === 'completion');
      }
      navigate(observation.taxonId ? `/species/${observation.taxonId}?saved=${observation.id}` : `/records?saved=${observation.id}`, { replace: true });
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  };
  const choose = (c: Choice) => {
    setChoice(c);
    setOthers(false);
    setQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('.device__scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="record">
      <RecordTop
        title="생물 확인"
        sub="등록 전에 이름을 확인해주세요"
        onBack={() => navigate('/record/where?then=pick', { replace: true })}
        help={
          <>
            <h2>이름이 맞는지 비교해요</h2>
            <p>사진과 추천된 생김새를 비교해 주세요. 다른 종이면 이름을 직접 고를 수 있어요. 미확인으로 남긴 사진은 팀이 확인해요.</p>
          </>
        }
      />
      <div className="record__body stack">
        <ShotCard draft={draft} photo={photo} onSelect={(id) => {
          setSelectedPhotoId(id);
          if (id !== photo.id && choice?.source === 'photo_ai') setChoice(null);
        }} />

        {identification.pending && <p className="notice" role="status">AI가 사진 속 생물을 살펴보는 중이에요.</p>}
        {identification.error && (
          <div className="stack stack--tight">
            <p className="caption" role="status">{IDENTIFY_ERROR_TEXT[identification.error] ?? '사진을 분석하지 못했어요. 다시 시도하거나 이름을 직접 찾아 주세요.'}</p>
            {!['daily_limit', 'global_limit'].includes(identification.error) && <button className="btn btn--outline btn--block" onClick={identification.retry}>AI 분석 다시 시도</button>}
          </div>
        )}
        {identification.result && !aiIds.length && <p className="caption" role="status">사진에서 종을 확실히 구별할 특징을 찾지 못했어요.</p>}

        {name && (
          <section className="guess" aria-live="polite">
            <p className="kicker">
              {choice ? '고른 이름' : 'AI 추정'}
              {taxon ? ` · ${CATEGORY_LABEL[taxon.category]}` : ''}
            </p>
            <h2 className="guess__name">{name}</h2>
            {taxon && <p className="sci">{taxon.scientificName}</p>}
          </section>
        )}

        {taxon && taxon.clue.looks.length > 0 && (
          <section className="sec">
            <h2 className="sec__title">사진과 비교해 보세요</h2>
            <ul className="ticks">
              {taxon.clue.looks.slice(0, 2).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {!identification.pending && alternatives.length > 0 && (
          <section className="sec">
            <h2 className="sec__title">{aiIds.length ? 'AI가 제안한 다른 후보' : '지도와 도감에서 찾아본 후보'}</h2>
            <ul className="alt-list">
              {alternatives.map((id) => {
                const t = taxonById(content, id);
                if (!t) return null;
                return (
                  <li key={id}>
                    <button className="alt" onClick={() => choose({
                      taxonId: id,
                      source: aiIds.length ? 'photo_ai' : candidateSource,
                      freeText: null,
                      candidateIds: aiIds.length ? aiIds : localIds,
                    })}>
                      <SpeciesArt taxon={t} size="sm" />
                      <span>
                        <strong>{t.koreanName}</strong>
                        <span className="muted">{t.clue.looks[0]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <WhereRow draft={draft} />

        <div className="stack stack--tight">
          {saveFailed && <p className="notice" role="alert">기록을 저장하지 못했어요. 다시 저장해 주세요.</p>}
          {current && <button className="btn btn--primary btn--block btn--big" disabled={saving} onClick={() => void confirm()}>
            {saving ? '저장 중…' : '맞아요, 도감에 등록'}
          </button>}
          <button className={`btn btn--${current ? 'outline' : 'primary'} btn--block btn--big`} onClick={() => setOthers(true)}>
            이름으로 직접 찾기
          </button>
          <Link to="/record/unknown" className="link-btn">
            아직 모르겠어요 · 미확인으로 저장
          </Link>
        </div>
      </div>

      {others && (
        <div className="help-sheet" role="dialog" aria-modal="true" aria-label="다른 생물 고르기">
          <button className="help-sheet__scrim" onClick={() => setOthers(false)} aria-label="닫기" />
          <div className="help-sheet__body help-sheet__body--tall">
            <span className="sheet-handle" aria-hidden="true" />
            <h2>어떤 생물이었나요?</h2>
            <label className="search-field">
              <Icon name="search" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 찾기 (예: 쇠물닭)" enterKeyHint="search" aria-label="이름으로 찾기" />
            </label>
            {!query.trim() && <p className="caption">공원에서 찾아볼 만한 생물이에요. 다른 생물은 이름을 적어 찾아 주세요.</p>}
            <ul className="search-results">
              {results.map((t) => (
                <li key={t.id}>
                  <button className="species-row species-row--button" onClick={() => choose({ taxonId: t.id, source: 'search', freeText: null })}>
                    <SpeciesArt taxon={t} size="xs" />
                    <span className="species-row__text">
                      <strong>{t.koreanName}</strong>
                      <span className="muted">{t.scientificName}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {query.trim() && (
              <button className="btn btn--outline btn--block" onClick={() => choose({ taxonId: null, source: 'free_text', freeText: query.trim().slice(0, 60) })}>
                ‘{query.trim()}’(으)로 남길게요
              </button>
            )}
            <Link to="/record/unknown" className="link-btn">
              아직 모르겠어요 · 미확인으로 저장
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

/** 아직 모르겠어요: 사진은 남기고 이름은 나중에(미동정). 관찰 메모는 ‘가족이 적은 이름·메모’로 갑니다. */
export function RecordUnknown() {
  const draft = useDraft();
  const { content, season } = useContent();
  const navigate = useNavigate();
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  if (draft === undefined) return null;
  if (draft === null) return <Navigate to="/" replace />;
  if (!draft.photos.length) return <Navigate to="/record/photo" replace />;
  if (!draft.subject) return <Navigate to="/record/where" replace />;
  const photo = draft.photos[0];

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const { observation } = await saveWith(content, season, draft, { taxonId: null, source: 'unknown', freeText: memo.trim().slice(0, 60) || null });
      navigate(`/records?saved=${observation.id}`, { replace: true });
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  };

  return (
    <main className="record">
      <RecordTop
        title="생물 확인"
        onBack={() => navigate('/record/pick', { replace: true })}
        help={
          <>
            <h2>몰라도 괜찮아요</h2>
            <p>미확인으로 저장하면 팀이 사진을 보고 이름을 확인해요. 확인되면 도감 칸이 열려요.</p>
          </>
        }
      />
      <div className="record__body stack">
        <div className="unknown-photo">
          <BlobImage blob={photo.display ?? photo.original} alt="찍은 사진" />
        </div>
        <div className="unknown-head">
          <span className="unknown-head__icon" aria-hidden="true">
            <Icon name="search" size={26} />
          </span>
          <h1>아직 이름을 찾지 못했어요</h1>
          <p>사진은 남겨두고, 이름은 나중에 확인할 수 있어요.</p>
        </div>
        <section className="sec">
          <h2 className="sec__title">이렇게 다시 찍어 보세요</h2>
          <ul className="ticks">
            <li>생물이 조금 더 크게 보이도록</li>
            <li>흔들리지 않게, 밝은 곳에서</li>
          </ul>
        </section>
        <label className="memo">
          <span className="sec__title">관찰 메모</span>
          <span className="memo__box">
            <input value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 60))} placeholder="어떤 모습이었나요?" maxLength={60} />
            <Icon name="pencil" size={20} />
          </span>
          <span className="caption">예: 목이 긴 하얀 새 · 팀이 이름을 확인할 때 봐요</span>
        </label>
        <WhereRow draft={draft} />
        <div className="stack stack--tight">
          <button className="btn btn--primary btn--block btn--big" onClick={() => navigate('/record/photo?then=pick&replace=1')}>
            <Icon name="camera" size={22} /> 다시 촬영하기
          </button>
          <button className="btn btn--secondary btn--block btn--big" disabled={saving} onClick={() => void save()}>
            <Icon name="bookmark" size={20} /> {saving ? '저장 중…' : '미확인 기록으로 저장'}
          </button>
          {saveFailed && <p className="notice" role="alert">기록을 저장하지 못했어요. 다시 저장해 주세요.</p>}
          <button
            className="link-btn"
            onClick={() =>
              void pickPhotos('album', MAX_PHOTOS).then(async (files) => {
                if (!files.length) return;
                try {
                  if (await addPhotos(files, 'album', true)) {
                    navigate('/record/pick', { replace: true });
                    return;
                  }
                } catch {
                  // 기존 사진은 그대로 남기고 다시 고를 수 있게 합니다.
                }
                setSaveFailed(true);
              })
            }
          >
            다른 사진 선택
          </button>
        </div>
        <p className="caption center">미확인 사진은 내 기록에 보관돼요. 팀이 이름을 확인하면 도감에 올라가요.</p>
      </div>
    </main>
  );
}

/** 예전 완료 화면 주소: 저장 뒤 화면(생물 카드 또는 내 기록)으로 보냅니다. */
export function RecordDone() {
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const obs = useLiveQuery(async () => ({ o: (await db.observations.get(id)) ?? null }), [id]);
  if (!obs) return null;
  if (!obs.o) return <Navigate to="/records" replace />;
  return <Navigate to={obs.o.taxonId ? `/species/${obs.o.taxonId}?saved=${id}` : `/records?saved=${id}`} replace />;
}
