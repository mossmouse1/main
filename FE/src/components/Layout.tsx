import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { isByteBacked } from '../data/blobBytes';
import { DEBUG, debugSet } from '../lib/debug';
import { useDex, useObjectUrl, useOnline, usePendingCount, usePendingPhotos } from '../hooks';
import { Icon } from './Icon';

/**
 * 화면 틀과 아래쪽 버튼 3개: 지도 · 촬영(가장 큰 버튼) · 도감(채운 칸 수).
 * 내 기록·설정은 도감 화면 머리글에서 엽니다(자주 쓰지 않는 것은 한 단계 안으로).
 * 버튼은 지도의 블록처럼 생겼고, 지도 홈에서는 지도 위에 떠 있습니다(지도가 화면 전체).
 */
export function TabLayout() {
  const { pathname } = useLocation();
  const dex = useDex();
  const onMap = pathname === '/' || pathname.startsWith('/zone');
  return (
    <div className={`app-shell${pathname === '/' ? ' is-map' : ''}`}>
      <SyncBar />
      <div className="tab-page">
        <Outlet />
      </div>
      <nav className="dock" aria-label="주요 화면">
        <NavLink to="/" end className={onMap ? 'active' : undefined}>
          <span className="dock__btn">
            <Icon name="explore" size={22} />
            <span>지도</span>
          </span>
        </NavLink>
        <NavLink to="/record" className="dock__shoot" aria-label="촬영">
          <span className="dock__shoot-btn">
            <Icon name="camera" size={24} />
            <span>촬영</span>
          </span>
        </NavLink>
        <NavLink to="/dex" className={onMap ? undefined : 'active'} aria-label={`도감, ${dex?.filled ?? 0}칸 채움, 모두 ${dex?.total ?? 0}칸`}>
          <span className="dock__btn">
            <Icon name="book" size={22} />
            <span>도감</span>
            <span className="dock__count">{dex?.filled ?? 0}</span>
          </span>
        </NavLink>
      </nav>
    </div>
  );
}

/** 대기 중인 기록 수를 화면 위에 보여 줍니다. 오프라인이어도 기록은 막지 않습니다. */
export function SyncBar() {
  const pending = usePendingCount();
  const photos = usePendingPhotos();
  const online = useOnline();
  if (online && pending === 0 && photos === 0) return null;
  return (
    <div className={`syncbar${online ? '' : ' is-offline'}`} role="status">
      <Icon name={online ? 'clock' : 'cloud'} size={16} />
      {online ? (
        <span>
          {pending > 0 ? `보내는 중인 기록 ${pending}건` : ''}
          {pending > 0 && photos > 0 ? ' · ' : ''}
          {photos > 0 ? `사진 업로드 대기 중 ${photos}장` : ''}
        </span>
      ) : (
        <span>
          오프라인{pending > 0 ? ` · 대기 중 ${pending}건` : ''} · 기록은 휴대폰에 먼저 저장돼요
        </span>
      )}
    </div>
  );
}

export function PageHeader({ title, right, backTo = '/' }: { title: string; right?: ReactNode; backTo?: string }) {
  const navigate = useNavigate();
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(backTo, { replace: true });
  };
  return (
    <header className="page-header">
      <button className="icon-btn" onClick={goBack} aria-label="뒤로">
        <Icon name="back" size={26} />
      </button>
      <h1>{title}</h1>
      <div className="page-header__right">{right}</div>
    </header>
  );
}

/** 화면 위에 잠깐 뜨는 알림(새로운 발견, 저장됨 등) */
export function Toast({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'soft' }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      {children}
    </div>
  );
}

export function Stepper({ label, value, onChange, max = 10 }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  max?: number;
}) {
  return (
    <div className="stepper">
      <span className="stepper__label">{label}</span>
      <button type="button" className="stepper__btn" aria-label={`${label} 줄이기`} onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}>
        −
      </button>
      <output className="stepper__value" aria-live="polite">
        {value ?? '–'}
      </output>
      <button type="button" className="stepper__btn" aria-label={`${label} 늘리기`} onClick={() => onChange(Math.min(max, (value ?? 0) + 1))}>
        +
      </button>
    </div>
  );
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * 사진 표시. 불러오지 못하면 ① 같은 Blob으로 주소를 새로 만들고 ② data URL(revoke되지 않음)로 한 번씩 더 시도하고,
 * 그래도 안 되면 안내(failText)를 보여 줍니다. diag는 ?debug=1 진단에 상태를 남깁니다(주 사진 한 곳만).
 */
export function BlobImage({ blob, alt, className, failText, diag = false }: { blob: Blob | null | undefined; alt: string; className?: string; failText?: string; diag?: boolean }) {
  const [stage, setStage] = useState(0); // 0 처음 · 1 주소 재생성 · 2 data URL · 3 실패
  const objectUrl = useObjectUrl(blob, Math.min(stage, 1));
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    setStage(0);
    setDataUrl(null);
    if (!diag || !DEBUG || !blob) return;
    debugSet('photo.size', blob.size);
    debugSet('photo.type', blob.type || '(none)');
    debugSet('photo.storage', isByteBacked(blob) ? 'ArrayBuffer' : 'Blob(legacy)');
    debugSet('photo.imgError', false);
    createImageBitmap(blob).then(
      (b) => (b.close(), debugSet('photo.bitmap', 'ok')),
      () => debugSet('photo.bitmap', 'fail'),
    );
  }, [blob, diag]);
  useEffect(() => {
    if (diag) debugSet('photo.stage', stage);
    if (stage !== 2 || !blob) return;
    let alive = true;
    toDataUrl(blob).then(
      (u) => alive && setDataUrl(u),
      () => alive && setStage(3),
    );
    return () => {
      alive = false;
    };
  }, [stage, blob, diag]);

  const src = stage === 2 ? dataUrl : objectUrl;
  if (!src || stage > 2) {
    return (
      <div className={`blob-missing ${className ?? ''}`} role="img" aria-label={alt}>
        <Icon name="image" />
        {stage > 2 && failText && <span>{failText}</span>}
      </div>
    );
  }
  const onError = () => {
    console.warn('BlobImage: load failed', { stage, type: blob?.type, size: blob?.size });
    if (diag) debugSet('photo.imgError', true);
    setStage((n) => n + 1);
  };
  return <img src={src} alt={alt} className={className} onError={onError} />;
}
