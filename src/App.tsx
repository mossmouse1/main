import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { TabLayout } from './components/Layout';
import { getMeta } from './data/db';
import { getHousehold, hasConsent } from './data/household';
import { startSync } from './data/sync';
import { track } from './data/track';
import { checkAutoEnd, touchWalk } from './data/walks';
import { useHousehold } from './hooks';
import { preloadPhotoTools } from './lib/photo';
import { Dex } from './screens/Dex';
import { MapHome } from './screens/MapHome';
import { RecordDone, RecordPhoto, RecordPick, RecordUnknown, RecordWhere } from './screens/Record';
import { Records } from './screens/Records';
import { Settings } from './screens/Settings';
import { SpeciesCard } from './screens/SpeciesCard';
import { WalkSummary } from './screens/WalkSummary';
import { Welcome } from './screens/Welcome';
import { ZoneDetail } from './screens/ZoneDetail';

const AdminApp = lazy(() => import('./admin/AdminApp'));

export function App() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<main className="center-screen">검토 화면을 여는 중…</main>}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route element={<FamilyShell />}>
        <Route path="welcome" element={<Welcome />} />
        <Route element={<TabLayout />}>
          <Route index element={<MapHome />} />
          <Route path="dex" element={<Dex />} />
          <Route path="records" element={<Records />} />
          <Route path="zone/:id" element={<ZoneDetail />} />
          <Route path="species/:id" element={<SpeciesCard />} />
          <Route path="walk/summary" element={<WalkSummary />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="record" element={<RequireConsent />}>
          <Route index element={<Navigate to="photo" replace />} />
          {/* 순서: 촬영 → 있던 곳 → 생물 확인(또는 아직 모르겠어요) → 생물 카드·내 기록 */}
          <Route path="photo" element={<RecordPhoto />} />
          <Route path="where" element={<RecordWhere />} />
          <Route path="pick" element={<RecordPick />} />
          <Route path="unknown" element={<RecordUnknown />} />
          <Route path="done" element={<RecordDone />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** 가족 화면 공통: 처음 한 번 안내, 전송 대기열, 탐험 자동 종료, 사용 기록 */
function FamilyShell() {
  const location = useLocation();
  // 처음 한 번만 정합니다. 안내를 마친 직후 값이 늦게 갱신돼 안내로 되돌아가는 일을 막습니다.
  const [needsWelcome, setNeedsWelcome] = useState<boolean | null>(null);
  // 늦게 온 결과(개발 모드에서 효과가 두 번 돌 때 포함)가 이미 정한 값을 덮지 않게 합니다.
  useEffect(() => {
    let alive = true;
    void getMeta('onboarded').then((v) => alive && setNeedsWelcome((cur) => cur ?? !v));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void getHousehold();
    void checkAutoEnd();
    const stopSync = startSync();
    const autoEnd = setInterval(() => void checkAutoEnd(), 60_000);
    const preload = setTimeout(preloadPhotoTools, 2000);
    const onPointer = () => void touchWalk();
    window.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      stopSync();
      clearInterval(autoEnd);
      clearTimeout(preload);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  useEffect(() => {
    track('screen_view', { path: location.pathname });
    void touchWalk();
  }, [location.pathname]);

  useEffect(() => {
    if (needsWelcome && location.pathname === '/welcome') setNeedsWelcome(false);
  }, [needsWelcome, location.pathname]);

  if (needsWelcome === null) return null;
  if (needsWelcome && location.pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  // 휴대폰에서는 화면 전체를, 태블릿·PC에서는 휴대폰 폭 틀을 씁니다(styles.css ‘화면 틀’).
  return (
    <div className="stage">
      <div className="device">
        <div className="device__scroll">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** 이용 조건에 동의해야 기록하기가 열립니다. 지도와 생물 카드는 동의 없이도 볼 수 있습니다. */
function RequireConsent() {
  const household = useHousehold();
  const location = useLocation();
  if (household === undefined) return null;
  if (!hasConsent(household ?? undefined)) {
    return <Navigate to={`/welcome?step=consent&next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <Outlet />;
}
