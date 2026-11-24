import { householdLabel } from '@shared/dwc';
import { useEffect, useState } from 'react';
import type { AdminRow, DeletionRequest } from '../backend/types';
import { useContent } from '../content/ContentProvider';
import { taxonById } from '../content/helpers';
import { formatDate } from '../lib/time';
import { useAdmin } from './AdminApp';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}% (${n}/${d})` : '–');

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A3 콘텐츠·지표: 지금은 콘텐츠를 읽기만 하고(편집은 v1.json), 품질 지표를 집계합니다. */
export function ContentAdmin() {
  const admin = useAdmin();
  const { content } = useContent();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [deletions, setDeletions] = useState<DeletionRequest[]>([]);

  useEffect(() => {
    void admin.listObservations({ includeHidden: true }).then(setRows);
    void admin.listDeletionRequests().then(setDeletions);
  }, [admin]);

  const visible = rows?.filter((r) => !r.hidden) ?? [];
  const complete = visible.filter((r) => r.observer_accuracy_m != null && r.photo_paths.length > 0 && r.walk_id && r.observed_at);
  const reviewedWithPick = visible.filter((r) => r.id_status === 'reviewed' && r.family_taxon_id);
  const judged = visible.filter((r) => r.id_status === 'reviewed' || r.id_status === 'undeterminable');
  const recordMinutes = visible
    .filter((r) => r.found_at)
    .map((r) => (Date.parse(r.client_created_at) - Date.parse(r.found_at!)) / 60000)
    .filter((m) => m >= 0 && m < 120);
  const med = median(recordMinutes);

  return (
    <div className="admin__page stack">
      <h1>품질 지표</h1>
      {rows === null ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <table className="table">
          <tbody>
            <tr>
              <th>기록 수(숨김 제외)</th>
              <td>
                {visible.length}건 · 숨김 {rows.length - visible.length}건
              </td>
            </tr>
            <tr>
              <th>참여 가족 수</th>
              <td>{new Set(visible.map((r) => r.household_no)).size}가족 (목표 30)</td>
            </tr>
            <tr>
              <th>필수 필드 완결률</th>
              <td>{pct(complete.length, visible.length)} — 시각·위치·정확도·사진·종 선택·탐험 (목표 100%)</td>
            </tr>
            <tr>
              <th>기록 시간 중간값</th>
              <td>{med == null ? '–' : `${med.toFixed(1)}분`} — ‘찾았어요’부터 저장까지 (목표 3분 이하)</td>
            </tr>
            <tr>
              <th>종 선택 일치율</th>
              <td>{pct(reviewedWithPick.filter((r) => r.family_taxon_id === r.taxon_id).length, reviewedWithPick.length)}</td>
            </tr>
            <tr>
              <th>검토 가능 비율</th>
              <td>{pct(judged.filter((r) => r.id_status === 'reviewed').length, judged.length)} (목표 70%)</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="caption">첫 기록 완료율·재방문은 usage_events(화면 진입·기록 단계 시각)로 현장 시험 뒤 집계합니다.</p>

      <h2>삭제 요청</h2>
      {deletions.length === 0 ? (
        <p className="muted">없어요.</p>
      ) : (
        <table className="table">
          <tbody>
            {deletions.map((d) => (
              <tr key={d.id}>
                <td>{householdLabel(d.householdNo)}</td>
                <td>{formatDate(d.requestedAt)}</td>
                <td>{d.reason}</td>
                <td>{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>계절 세트</h2>
      {content.seasonSets.map((s) => (
        <div key={s.id} className="card stack">
          <strong>
            {s.label} ({s.startsOn} ~ {s.endsOn}){s.draft ? ' · 초안' : ''}
          </strong>
          <span>퀘스트 후보 {s.dex.length}종 · 가족별 10종</span>
          <span>
            후보: {s.dex.map((id) => taxonById(content, id)?.koreanName).join(', ')}
          </span>
        </div>
      ))}

      <h2>아직 임시인 콘텐츠</h2>
      <ul className="plain-list">
        {content.placeholders.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="caption">
        생물 카드·6종·단서 편집 화면(F16)은 아직 없습니다. public/content/v1.json을 고치고 npm run seed:sql로 서버 시드를 다시 만듭니다.
      </p>
    </div>
  );
}
