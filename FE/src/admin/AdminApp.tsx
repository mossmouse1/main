import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import { getAdminBackend } from '../backend';
import type { AdminBackend } from '../backend/types';
import { BACKEND_MODE } from '../config';
import { ContentAdmin } from './ContentAdmin';
import { ExportPage } from './ExportPage';
import { ReportPage } from './ReportPage';
import { Review } from './Review';
import './admin.css';

const AdminContext = createContext<AdminBackend | null>(null);

export function useAdmin(): AdminBackend {
  const b = useContext(AdminContext);
  if (!b) throw new Error('AdminContext 없음');
  return b;
}

/** 팀 검토자 화면(/admin). PC 기준입니다. */
export default function AdminApp() {
  const [backend, setBackend] = useState<AdminBackend | null>(null);
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);

  useEffect(() => {
    void getAdminBackend().then(async (b) => {
      setBackend(b);
      setUser(await b.currentUser().catch(() => null));
    });
  }, []);

  if (!backend || user === undefined) return <main className="center-screen">검토 화면을 여는 중…</main>;
  if (!user) return <Login backend={backend} onDone={setUser} />;

  return (
    <AdminContext.Provider value={backend}>
      <div className="admin">
        <header className="admin__header">
          <strong>우리 공원 생명 도감 · 팀 검토</strong>
          <nav>
            {/* 절대 경로: /admin/* 안에서 상대 경로를 쓰면 누를 때마다 /admin/report/review…로 쌓입니다. */}
            <NavLink to="/admin/report">보고서</NavLink>
            <NavLink to="/admin/review">검토 대기열</NavLink>
            {/* 내보내기·콘텐츠·지표는 메뉴에서만 뺐습니다(/admin/export, /admin/content 경로는 그대로). */}
          </nav>
          <span className="admin__user">
            {user.email}
            {BACKEND_MODE === 'supabase' && (
              <button
                className="btn btn--ghost btn--small"
                onClick={async () => {
                  await backend.signOut();
                  setUser(null);
                }}
              >
                로그아웃
              </button>
            )}
          </span>
        </header>
        {BACKEND_MODE === 'local' && (
          <p className="admin__banner">로컬 모드: 이 브라우저에서 남긴 기록만 보여요. 실제 운영은 Supabase를 연결하세요.</p>
        )}
        <div className="admin__body">
        <Routes>
          <Route index element={<Navigate to="/admin/report" replace />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="review" element={<Review />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="content" element={<ContentAdmin />} />
        </Routes>
        </div>
      </div>
    </AdminContext.Provider>
  );
}

function Login({ backend, onDone }: { backend: AdminBackend; onDone: (u: { email: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="center-screen">
      <form
        className="card stack admin-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await backend.signIn(email, password);
            const u = await backend.currentUser();
            if (u) onDone(u);
          } catch (err) {
            setError(err instanceof Error ? err.message : '로그인하지 못했어요');
          }
        }}
      >
        <h1>팀 검토자 로그인</h1>
        <label className="field">
          <span>이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--primary">로그인</button>
      </form>
    </main>
  );
}
