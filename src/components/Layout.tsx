import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useObjectUrl, useOnline, usePendingCount } from '../hooks';
import { Icon } from './Icon';

/** 하단 탭 4개(PRD 4장): 탐험 · 도감 · 촬영 · 내 기록. 촬영은 떠 있는 큰 버튼, 설정은 내 기록 머리글에서 엽니다. */
export function TabLayout() {
  const { pathname } = useLocation();
  const inRecords = pathname.startsWith('/records') || pathname.startsWith('/settings') || pathname.startsWith('/walk');
  return (
    <div className="app-shell">
      <SyncBar />
      <div className="tab-page">
        <Outlet />
      </div>
      <nav className="tabbar" aria-label="주요 화면">
        <NavLink to="/" end>
          <span className="tabbar__item">
            <Icon name="explore" />
            <span>탐험</span>
          </span>
        </NavLink>
        <NavLink to="/dex">
          <span className="tabbar__item">
            <Icon name="book" />
            <span>도감</span>
          </span>
        </NavLink>
        <NavLink to="/record" className="tabbar__fab" aria-label="촬영">
          <span className="tabbar__fab-circle">
            <Icon name="camera" size={28} />
            <span>촬영</span>
          </span>
        </NavLink>
        <NavLink to="/records" className={inRecords ? 'active' : undefined}>
          <span className="tabbar__item">
            <Icon name="clipboard" />
            <span>내 기록</span>
          </span>
        </NavLink>
      </nav>
    </div>
  );
}

/** 대기 중인 기록 수를 화면 위에 보여 줍니다. 오프라인이어도 기록은 막지 않습니다. */
export function SyncBar() {
  const pending = usePendingCount();
  const online = useOnline();
  if (online && pending === 0) return null;
  return (
    <div className={`syncbar${online ? '' : ' is-offline'}`} role="status">
      <Icon name={online ? 'clock' : 'cloud'} size={16} />
      {online ? (
        <span>보내는 중인 기록 {pending}건</span>
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

export function BlobImage({ blob, alt, className }: { blob: Blob | null | undefined; alt: string; className?: string }) {
  const url = useObjectUrl(blob);
  if (!url) {
    return (
      <div className={`blob-missing ${className ?? ''}`} role="img" aria-label={alt}>
        <Icon name="image" />
      </div>
    );
  }
  return <img src={url} alt={alt} className={className} />;
}
