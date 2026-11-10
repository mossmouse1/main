import { ID_STATUS_LABEL, type IdStatus } from '@shared/dwc';
import { useEffect, useState } from 'react';
import type { AdminFilters } from '../backend/types';
import { useAdmin } from './AdminApp';

const STATUSES = Object.keys(ID_STATUS_LABEL) as IdStatus[];

/** A2 내보내기: 기간·검토 상태로 걸러 Darwin Core CSV(기록 1건 = 1행) */
export function ExportPage() {
  const admin = useAdmin();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statuses, setStatuses] = useState<IdStatus[]>(STATUSES);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters: AdminFilters = { from: from || undefined, to: to || undefined, statuses };

  useEffect(() => {
    setCount(null);
    void admin.listObservations({ from: from || undefined, to: to || undefined, statuses }).then((r) => setCount(r.length));
  }, [admin, from, to, statuses]);

  const download = async (kind: 'observations' | 'history') => {
    setBusy(true);
    setError(null);
    try {
      const blob = await admin.exportCsv(kind, filters);
      const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `park-dex-${kind === 'observations' ? 'occurrences' : 'identification-history'}-${stamp}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin__page stack">
      <h1>내보내기</h1>
      <div className="card stack">
        <div className="row row--wrap">
          <label className="field">
            <span>시작일(관찰일, 한국 시간)</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>종료일</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <fieldset className="row row--wrap">
          <legend>검토 상태</legend>
          {STATUSES.map((s) => (
            <label key={s} className="check">
              <input
                type="checkbox"
                checked={statuses.includes(s)}
                onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s))}
              />
              <span>{ID_STATUS_LABEL[s]}</span>
            </label>
          ))}
        </fieldset>
        <p>{count === null ? '세는 중…' : `내보낼 기록 ${count}건`}</p>
        <div className="row row--wrap">
          <button className="btn btn--primary" disabled={busy || !statuses.length} onClick={() => void download('observations')}>
            관찰 기록 CSV
          </button>
          <button className="btn btn--secondary" disabled={busy || !statuses.length} onClick={() => void download('history')}>
            검토 이력 CSV
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
      <ul className="caption plain-list">
        <li>UTF-8(BOM 포함) CSV라 엑셀에서 한글이 그대로 열려요. 열 이름은 Darwin Core 용어입니다.</li>
        <li>숨긴 기록과 숨긴 사진은 빠집니다. associatedMedia에는 사진 저장소 경로가 들어갑니다.</li>
        <li>license 열은 자료 이용 조건이 정해지면 채웁니다(PRD 12장 미결).</li>
      </ul>
    </div>
  );
}
