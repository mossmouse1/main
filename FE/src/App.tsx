import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { DebugPanel } from './components/DebugPanel';
import { TabLayout } from './components/Layout';
import { DEBUG } from './lib/debug';
import { getHousehold, hasConsent } from './data/household';
import { startSync } from './data/sync';
import { track } from './data/track';
import { checkAutoEnd, touchWalk } from './data/walks';
import { useHousehold } from './hooks';
import { preloadPhotoTools } from './lib/photo';
import { Dex } from './screens/Dex';
import { QuestCompletion } from './screens/QuestCompletion';
import { MapHome } from './screens/MapHome';
import { FieldPhotos } from './screens/FieldPhotos';
import { PublicObservations } from './screens/PublicObservations';
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
    <>
      {DEBUG && <DebugPanel />}
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
          <Route path="public-observations" element={<PublicObservations />} />
          <Route path="dex" element={<Dex />} />
          <Route path="dex/field" element={<FieldPhotos />} />
          <Route path="dex/complete" element={<QuestCompletion />} />
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
    </>
  );
}

/**
 * 가족 화면 공통: 전송 대기열, 탐험 자동 종료, 사용 기록.
 * 전체 지도에서 바로 시작하고 동의는 처음 기록할 때(RequireConsent) 한 번만 받습니다.
 */
function FamilyShell() {
  const location = useLocation();
  const navigation = useNavigationType();
  const scroll = useRef<HTMLDivElement>(null);
  const previousPath = useRef(location.pathname);

  useLayoutEffect(() => {
    if (previousPath.current !== location.pathname && navigation !== 'POP') {
      scroll.current?.querySelector('.tab-page')?.scrollTo(0, 0);
      scroll.current?.scrollTo(0, 0);
      window.scrollTo(0, 0);
    }
    previousPath.current = location.pathname;
  }, [location.pathname, navigation]);

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

  // 휴대폰에서는 화면 전체를, 태블릿·PC에서는 휴대폰 폭 틀을 씁니다(styles.css ‘화면 틀’).
  return (
    <div className="stage">
      <div className="device">
        <div className="device__scroll" ref={scroll}>
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
