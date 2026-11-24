import { useEffect, useState } from 'react';
import type { AdminRow } from '../backend/types';
import { useContent } from '../content/ContentProvider';
import { taxonById } from '../content/helpers';
import { useAdmin } from './AdminApp';
import { appearances, isAlien, isOutOfDex, isProtected, isUnverified, kstDateTime, participantNumbers, recordRow, summarize, type Appearance } from './report';

const Unverified = () => <span className="badge badge--wait">검증 전</span>;

function AppearanceTable({ list, withProtection }: { list: Appearance[]; withProtection?: boolean }) {
  if (!list.length) return <p className="muted">해당 기록이 없어요.</p>;
  return (
    <div className="table-scroll"><table className="table">
      <thead>
        <tr>
          <th>종명</th>
          <th className="num">기록 수</th>
          <th>처음 관찰일</th>
          <th>마지막 관찰일</th>
          <th>구역 / 비오톱</th>
          {withProtection && <th>보호 구분</th>}
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.taxonId}>
            <td>
              {a.name} {!a.verified && <Unverified />}
            </td>
            <td className="num">{a.count}</td>
            <td className="nowrap">{a.first}</td>
            <td className="nowrap">{a.last}</td>
            <td>{a.places}</td>
            {withProtection && <td>{a.protection}</td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/** 보고서(위에서 아래로 한 화면): 요약 → 외래종 → 보호종 → 도감 밖 기록 → 전체 기록 */
export function ReportPage() {
  const admin = useAdmin();
  const { content } = useContent();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    void admin
      .listObservations({ from: from || undefined, to: to || undefined })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [admin, from, to]);

  const period = from || to ? `${from || '처음'} ~ ${to || '현재'}` : '전체';
  const taxonOf = (id: string | null) => (id ? taxonById(content, id) : undefined);

  const download = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const { buildReportXlsx } = await import('./reportXlsx');
      const blob = await buildReportXlsx(rows, period, taxonOf);
      const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `우리공원생명도감_보고서_${stamp}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const people = rows ? participantNumbers(rows) : new Map<number, number>();
  const sum = rows && summarize(rows);
  const outOfDex = rows?.filter(isOutOfDex) ?? [];
  const table = rows?.map((r) => ({ r, x: recordRow(r, people.get(r.household_no)!, taxonOf(r.taxon_id)) })) ?? [];

  return (
    <div className="admin__page stack report">
      <h1>보고서</h1>
      <div className="report__print-head">
        <strong>우리 공원 생명 도감 · 보고서</strong>
        <span>기간: {period}</span>
        <span>출력일: {kstDateTime(new Date().toISOString()).slice(0, 10)}</span>
      </div>
      <div className="card row row--wrap report__controls">
        <label className="field">
          <span>시작일(관찰일, 한국 시간)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>종료일</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn btn--primary" disabled={busy || !rows} onClick={() => void download()}>
          엑셀 다운로드
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="caption">기간: {period} · 숨긴 기록 제외 · 가족은 첫 기록 순서대로 참여자 1, 2, 3…으로 표시합니다.</p>

      {!rows || !sum ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <>
          <section className="stack">
            <h2>1. 요약</h2>
            <div className="stats">
              <div><strong>{sum.records}</strong><span>총 기록 수</span></div>
              <div><strong>{sum.households}</strong><span>참여 가족 수</span></div>
              <div><strong>{sum.species}</strong><span>관찰 종 수</span></div>
              <div><strong>{Math.round(sum.photoRate * 100)}%</strong><span>사진 있는 기록</span></div>
            </div>
          </section>

          <section className="stack">
            <h2>2. 외래종 출현</h2>
            <AppearanceTable list={appearances(rows, isAlien)} />
            <p className="caption">종별 외래종·보호 구분은 아직 공식 목록과 대조하지 않은 초안입니다. 공란은 “해당 없음”이 아니라 “아직 확인 안 됨”입니다.</p>
          </section>

          <section className="stack">
            <h2>3. 희귀종·보호종 출현</h2>
            <AppearanceTable list={appearances(rows, isProtected)} withProtection />
          </section>

          <section className="stack">
            <h2>4. 도감 밖 기록</h2>
            {outOfDex.length === 0 ? (
              <p className="muted">해당 기록이 없어요.</p>
            ) : (
              <div className="table-scroll"><table className="table">
                <thead>
                  <tr>
                    <th className="nowrap">관찰일시(KST)</th>
                    <th>참여자</th>
                    <th>적은 이름</th>
                    <th>종 선택 방식</th>
                    <th>구역</th>
                    <th>확인</th>
                  </tr>
                </thead>
                <tbody>
                  {table
                    .filter(({ r }) => isOutOfDex(r))
                    .map(({ r, x }) => (
                      <tr key={r.id}>
                        <td className="nowrap">{x.observedAt}</td>
                        <td className="nowrap">{x.participant}</td>
                        <td>{r.free_text_name ?? ''}</td>
                        <td>{x.pickSource}</td>
                        <td className="nowrap">{x.zone}</td>
                        <td>전문가 확인 필요</td>
                      </tr>
                    ))}
                </tbody>
              </table></div>
            )}
          </section>

          <section className="stack">
            <h2>5. 전체 기록 (최신순)</h2>
            <div className="table-scroll"><table className="table">
              <thead>
                <tr>
                  <th className="nowrap">관찰일시(KST)</th>
                  <th>참여자</th>
                  <th>종명</th>
                  <th>종 선택 방식</th>
                  <th>구역</th>
                  <th className="num">사진 수</th>
                  <th>외래종</th>
                  <th>보호 구분</th>
                  <th>검수 상태</th>
                </tr>
              </thead>
              <tbody>
                {table.map(({ r, x }) => (
                  <tr key={r.id}>
                    <td className="nowrap">{x.observedAt}</td>
                    <td className="nowrap">{x.participant}</td>
                    <td>
                      {x.name} {isUnverified(r) && <Unverified />}
                    </td>
                    <td>{x.pickSource}</td>
                    <td className="nowrap">{x.zone}</td>
                    <td className="num">{x.photos}</td>
                    <td>{x.alien}</td>
                    <td>{x.protection}</td>
                    <td>{x.review}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </div>
  );
}
