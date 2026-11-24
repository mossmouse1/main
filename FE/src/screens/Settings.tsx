import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getFamilyBackend } from '../backend';
import { PageHeader, Stepper } from '../components/Layout';
import { BACKEND_MODE, CONSENT_VERSION } from '../config';
import { useContent } from '../content/ContentProvider';
import { setPartyDefaults } from '../data/household';
import { enqueue } from '../data/sync';
import { useHousehold } from '../hooks';
import { formatDate, formatTime } from '../lib/time';
import { CONSENT_ITEMS } from './Welcome';

/** S11 설정: 기록 지키기(이메일 연결), 동의 내용 보기, 기록 삭제 요청 */
export function Settings() {
  const household = useHousehold();
  const { content } = useContent();

  if (household === undefined) return null;

  return (
    <main className="page">
      <PageHeader title="설정" backTo="/records" />
      <div className="page__body stack">
        <KeepRecords />

        {household && (
          <section className="card stack">
            <h2>함께 오는 사람 (기본값)</h2>
            <Stepper label="어른" value={household.adults} onChange={(v) => void setPartyDefaults(v, household.children)} />
            <Stepper label="아이" value={household.children} onChange={(v) => void setPartyDefaults(household.adults, v)} />
            <p className="caption">탐험을 시작할 때 이 값이 먼저 들어가요.</p>
          </section>
        )}

        <section className="card stack">
          <h2>동의 내용</h2>
          {household?.consentedAt ? (
            <>
              <ul className="plain-list">
                {CONSENT_ITEMS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="caption">
                {formatDate(household.consentedAt)} {formatTime(household.consentedAt)}에 동의 · 문구 버전 {household.consentVersion}
              </p>
            </>
          ) : (
            <>
              <p>아직 동의하지 않았어요. 동의해야 기록을 남길 수 있어요.</p>
              <Link to="/welcome?step=consent" className="btn btn--primary">
                동의하러 가기
              </Link>
            </>
          )}
        </section>

        {household?.consentedAt && <DeleteRequest />}

        <Link to="/?guide=1" className="btn btn--outline">
          탐험 가이드 다시 보기
        </Link>

        <p className="caption">
          서버: {BACKEND_MODE === 'supabase' ? 'Supabase' : '로컬 모드(이 브라우저 안의 가짜 서버)'} · 콘텐츠 v{content.version} ({content.updatedAt}) · 동의 문구 {CONSENT_VERSION}
        </p>
      </div>
    </main>
  );
}

/** F14 기록 지키기: 이메일을 연결하면 기기를 바꿔도 도감이 이어집니다. */
function KeepRecords() {
  const [email, setEmail] = useState('');
  const [linked, setLinked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getFamilyBackend()
      .then((b) => b.linkedEmail())
      .then(setLinked)
      .catch(() => {});
  }, []);

  if (BACKEND_MODE !== 'supabase') {
    return (
      <section className="card stack">
        <h2>기록 지키기</h2>
        <p>이메일을 연결하면 휴대폰을 바꾸거나 브라우저 저장소가 지워져도 도감이 이어져요.</p>
        <p className="caption">로컬 모드에서는 쓸 수 없어요. 서버를 연결하면 열려요.</p>
      </section>
    );
  }

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await (await getFamilyBackend()).linkEmail(email.trim());
      setMessage('메일을 보냈어요. 메일의 링크를 누르면 연결이 끝나요.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '메일을 보내지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2>기록 지키기</h2>
      {linked ? (
        <p className="ok-line">{linked}에 연결되어 있어요.</p>
      ) : (
        <>
          <p>이메일을 연결하면 휴대폰을 바꾸거나 브라우저 저장소가 지워져도 도감이 이어져요. 이메일은 이 용도로만 써요.</p>
          <label className="field">
            <span>보호자 이메일</span>
            <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn--secondary btn--block" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onClick={() => void submit()}>
            연결 메일 받기
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function DeleteRequest() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'sent'>('idle');
  const [reason, setReason] = useState('');
  return (
    <section className="card stack">
      <h2>기록 삭제 요청</h2>
      {step === 'sent' ? (
        <p role="status">요청했어요. 팀이 확인하고 우리 가족 기록과 사진을 지워요.</p>
      ) : step === 'confirm' ? (
        <>
          <label className="field">
            <span>이유 (선택)</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} />
          </label>
          <div className="row">
            <button className="btn btn--ghost" onClick={() => setStep('idle')}>
              취소
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                await enqueue({ kind: 'deletion', refId: reason.trim() || '사유 없음' });
                setStep('sent');
              }}
            >
              삭제 요청 보내기
            </button>
          </div>
        </>
      ) : (
        <>
          <p>우리 가족이 남긴 기록과 사진을 지워 달라고 팀에 요청해요.</p>
          <button className="btn btn--secondary btn--block" onClick={() => setStep('confirm')}>
            삭제 요청하기
          </button>
        </>
      )}
    </section>
  );
}
