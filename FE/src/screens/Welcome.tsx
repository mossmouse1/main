import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Layout';
import { CONSENT_VERSION } from '../config';
import { hasConsent, saveConsent } from '../data/household';
import { useHousehold } from '../hooks';
import { getPosition, locationPermission, type PermissionResult } from '../platform';

export const CONSENT_ITEMS = [
  '우리 가족이 남긴 기록(사진, 시각, 위치, 고른 이름)을 공원 생태 조사 자료로 쓰는 데 동의해요.',
  '사진은 사람 얼굴이 나오지 않게 찍을게요. 팀이 확인한 사진만 조사 자료에 넣는 데 동의해요.',
];

/**
 * S0 시작하기 전에: 이용 조건 동의 → 위치 사용 → 함께 온 사람 수(선택).
 * 처음 기록할 때 한 번만 나옵니다(RequireConsent가 ?next=로 보냄). 처음 안내 슬라이드는 지도 홈의 코치마크로 바꿨습니다.
 */
export function Welcome() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const household = useHousehold();
  const next = params.get('next') || '/';
  const finish = (to: string) => navigate(to, { replace: true });

  if (household === undefined) return null;
  if (hasConsent(household ?? undefined)) return <Navigate to={next} replace />;
  return <ConsentStep defaults={household} onDone={finish} next={next} />;
}

function ConsentStep({ defaults, onDone, next }: {
  defaults: { adults: number | null; children: number | null } | null;
  onDone: (to: string) => void;
  next: string;
}) {
  const [agreed, setAgreed] = useState([false, false]);
  const [adults, setAdults] = useState<number | null>(defaults?.adults ?? null);
  const [children, setChildren] = useState<number | null>(defaults?.children ?? null);
  const [permission, setPermission] = useState<PermissionResult>('unknown');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void locationPermission().then(setPermission);
  }, []);

  const askLocation = async () => {
    setAsking(true);
    const fix = await getPosition();
    setPermission(fix ? 'granted' : await locationPermission().then((p) => (p === 'unknown' ? 'denied' : p)));
    setAsking(false);
  };

  const submit = async () => {
    await saveConsent(adults, children);
    onDone(next);
  };

  return (
    <main className="welcome welcome--consent">
      <p className="kicker">첫 기록 전에 한 번만</p>
      <h1>시작하기 전에</h1>
      <p className="muted">이름, 연락처, 아이 정보는 받지 않아요.</p>

      <fieldset className="consent">
        <legend>꼭 필요한 동의</legend>
        {CONSENT_ITEMS.map((text, i) => (
          <label key={text} className="check">
            <input type="checkbox" checked={agreed[i]} onChange={(e) => setAgreed(agreed.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span>{text}</span>
          </label>
        ))}
        <p className="caption">동의 문구 초안 · {CONSENT_VERSION}</p>
      </fieldset>

      <section className="card stack">
        <h2>위치 사용</h2>
        {permission === 'granted' ? (
          <p className="ok-line">
            <Icon name="check" size={20} /> 위치를 쓸 수 있어요
          </p>
        ) : permission === 'denied' ? (
          <p>위치를 쓰지 않기로 했어요. 지도와 기록은 그대로 쓸 수 있어요. 휴대폰 설정에서 언제든 켤 수 있어요.</p>
        ) : (
          <button className="btn btn--secondary btn--block" onClick={() => void askLocation()} disabled={asking}>
            <Icon name="locate" /> {asking ? '확인하는 중…' : '위치 사용 허용하기'}
          </button>
        )}
      </section>

      <section className="card stack">
        <h2>오늘 함께 온 사람 (선택)</h2>
        <Stepper label="어른" value={adults} onChange={setAdults} />
        <Stepper label="아이" value={children} onChange={setChildren} />
        <p className="caption">건너뛰어도 괜찮아요. 몇 명이 얼마나 찾았는지 알면 기록이 더 쓸모 있어져요.</p>
      </section>

      <div className="welcome__actions">
        <button className="btn btn--primary btn--block btn--big" disabled={!agreed.every(Boolean)} onClick={() => void submit()}>
          동의하고 기록하기
        </button>
        <button className="btn btn--text btn--block" onClick={() => onDone('/')}>
          지금은 둘러보기만 할게요
        </button>
      </div>
    </main>
  );
}
