import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { BrandMark } from '../components/Illustrations';
import { Stepper } from '../components/Layout';
import { CONSENT_VERSION } from '../config';
import { setMeta } from '../data/db';
import { hasConsent, saveConsent } from '../data/household';
import { useContent } from '../content/ContentProvider';
import { useHousehold } from '../hooks';
import { getPosition, locationPermission, type PermissionResult } from '../platform';

const SLIDES: { icon: IconName; title: string; body: string[] }[] = [
  { icon: 'map', title: '공원에서 생물을 찾아요', body: ['오늘 찾을 6종의 단서를 함께 읽고,', '찾으면 사진을 찍어 도감을 채워요.'] },
  { icon: 'pin', title: '위치는 기록할 때만 써요', body: ['생물을 찾은 곳을 지도에 남기려고 위치를 써요.', '걸어간 길은 저장하지 않아요.'] },
  { icon: 'book', title: '기록은 공원 조사에 쓰여요', body: ['팀이 기록을 확인한 뒤,', '공원에서 다시 조사해 볼 곳을 찾는 데 써요.'] },
];

export const CONSENT_ITEMS = [
  '우리 가족이 남긴 기록(사진, 시각, 위치, 고른 이름)을 공원 생태 조사 자료로 쓰는 데 동의해요.',
  '사진은 사람 얼굴이 나오지 않게 찍을게요. 팀이 확인한 사진만 조사 자료에 넣는 데 동의해요.',
];

/** S0 처음 안내: 안내 3장 → 이용 조건 동의 → 함께 온 사람 수(선택) */
export function Welcome() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const household = useHousehold();
  const next = params.get('next') || '/';
  const [step, setStep] = useState(0);
  // 동의 단계는 주소에 남겨서 새로고침(웹뷰 재시작 포함)돼도 그 자리로 돌아옵니다.
  const atConsent = params.get('step') === 'consent';

  const finish = async (to: string) => {
    await setMeta('onboarded', true);
    navigate(to, { replace: true });
  };
  const goNext = () => {
    if (step < SLIDES.length - 1) setStep(step + 1);
    else setParams({ step: 'consent', ...(params.get('next') ? { next } : {}) }, { replace: true });
  };

  if (!atConsent) {
    const slide = SLIDES[step];
    return (
      <main className="welcome welcome--intro">
        <p className="welcome__brand">
          <BrandMark size={30} /> 호수도감
        </p>
        <WelcomeArt step={step} icon={slide.icon} />
        <h1>{slide.title}</h1>
        {slide.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <ol className="dots" aria-label={`${SLIDES.length}장 중 ${step + 1}장`}>
          {SLIDES.map((s, i) => (
            <li key={s.title} className={i === step ? 'is-on' : undefined} />
          ))}
        </ol>
        <div className="welcome__actions">
          <button className="btn btn--primary btn--block btn--big" onClick={goNext}>
            {step === SLIDES.length - 1 ? '시작 준비하기' : '다음'}
          </button>
          <button className="btn btn--text btn--block" onClick={() => void finish('/')}>
            건너뛰고 지도 보기
          </button>
        </div>
      </main>
    );
  }

  if (household === undefined) return null;
  if (hasConsent(household ?? undefined)) {
    return (
      <main className="welcome">
        <h1>이미 동의했어요</h1>
        <button className="btn btn--primary btn--block" onClick={() => void finish(next)}>
          계속하기
        </button>
      </main>
    );
  }
  return <ConsentStep defaults={household} onDone={(to) => void finish(to)} next={next} />;
}

/** 안내 그림: 1장 실제 생물 사진, 2장 실제 공원 지도, 3장 기록이 쓰이는 길 */
function WelcomeArt({ step, icon }: { step: number; icon: IconName }) {
  const { content, mapUrl } = useContent();
  if (step === 0) {
    const picks = photosOf(content, ['eurasian-coot', 'oriental-magpie', 'japanese-winterberry']);
    return (
      <div className="welcome__photos" aria-hidden="true">
        {picks.map((src, i) => (
          <img key={src} src={src} alt="" className={`welcome__photo welcome__photo--${i}`} />
        ))}
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="welcome__map" aria-hidden="true">
        <img src={mapUrl} alt="" />
        <span className="welcome__pin">
          <Icon name="pin" size={28} />
        </span>
      </div>
    );
  }
  return (
    <div className="welcome__art">
      <Icon name={icon} size={64} />
    </div>
  );
}

function photosOf(content: ReturnType<typeof useContent>['content'], ids: string[]): string[] {
  return ids.map((id) => content.taxa.find((t) => t.id === id)?.photo?.src).filter((s): s is string => !!s);
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
          동의하고 시작하기
        </button>
        <button className="btn btn--text btn--block" onClick={() => onDone('/')}>
          둘러보기만 할게요
        </button>
      </div>
    </main>
  );
}
