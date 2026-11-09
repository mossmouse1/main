import { householdLabel, type HistoryRow, type IdStatus } from '@shared/dwc';
import { useEffect, useState } from 'react';
import type { AdminPhoto, AdminRow, ReviewChanges } from '../backend/types';
import { IdStatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { ParkMap } from '../components/ParkMap';
import { useContent } from '../content/ContentProvider';
import { taxonById } from '../content/helpers';
import { CATEGORY_LABEL, type Category } from '../content/types';
import { ID_STATUS_LABEL } from '../data/types';
import { formatDate, formatTime } from '../lib/time';
import { useAdmin } from './AdminApp';

type Tab = 'queue' | 'all' | 'hidden';

/** A1 검토 대기열: 미동정·추정 기록, 종 확정·사유, 중복 묶기, 숨기기 */
export function Review() {
  const admin = useAdmin();
  const [tab, setTab] = useState<Tab>('queue');
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const filters = tab === 'queue' ? { statuses: ['unidentified', 'family'] as IdStatus[] } : { includeHidden: tab === 'hidden' };
    void admin.listObservations(filters).then((r) => setRows(tab === 'hidden' ? r.filter((x) => x.hidden) : r));
  }, [admin, tab, version]);

  const row = rows?.find((r) => r.id === selected) ?? null;

  return (
    <div className={`review${row ? ' has-selection' : ''}`}>
      <aside className="review__list">
        <div className="tabs" role="tablist">
          {(
            [
              ['queue', '검토 대기'],
              ['all', '전체'],
              ['hidden', '숨김'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {rows === null ? (
          <p className="muted">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="muted">기록이 없어요.</p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  className={`review-item${r.id === selected ? ' is-on' : ''}`}
                  onClick={() => {
                    setSelected(r.id);
                    // 좁은 화면에서는 목록 자리에 상세가 열리므로 맨 위로 올립니다.
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <span className="review-item__top">
                    <strong>{r.vernacular_name ?? (r.free_text_name ? `‘${r.free_text_name}’` : '이름 모름')}</strong>
                    <IdStatusBadge status={r.id_status} />
                  </span>
                  <span className="muted">
                    {formatDate(r.observed_at)} {formatTime(r.observed_at)} · {householdLabel(r.household_no)} · {r.zone_id ?? (r.outside_park ? '공원 밖' : '구역 밖')} · 사진 {r.photo_paths.length}
                    {r.duplicate_group_id ? ' · 묶음' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="review__detail">
        {row ? (
          <>
            <button className="btn btn--ghost btn--small review__back" onClick={() => setSelected(null)}>
              <Icon name="back" size={18} /> 목록으로
            </button>
            <ReviewDetail key={`${row.id}:${version}`} row={row} onChanged={() => setVersion((v) => v + 1)} />
          </>
        ) : (
          <p className="muted">왼쪽에서 기록을 고르세요.</p>
        )}
      </section>
    </div>
  );
}

function ReviewDetail({ row, onChanged }: { row: AdminRow; onChanged: () => void }) {
  const admin = useAdmin();
  const { content, mapUrl } = useContent();
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [dupes, setDupes] = useState<AdminRow[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [taxonId, setTaxonId] = useState(row.taxon_id ?? '');
  const [reason, setReason] = useState('');
  const [hiddenReason, setHiddenReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void admin.listPhotos(row.id).then(setPhotos);
    void admin.history(row.id).then(setHistory);
    void admin.duplicateCandidates(row.id).then(setDupes);
  }, [admin, row.id]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const review = (changes: ReviewChanges) => act(() => admin.review(row.id, changes));

  const familyPick = row.family_taxon_id
    ? taxonById(content, row.family_taxon_id)?.koreanName
    : row.free_text_name
      ? `‘${row.free_text_name}’(직접 입력)`
      : '잘 모르겠어요';
  const byCategory = (['waterbird', 'townbird', 'tree'] as Category[]).map((c) => [c, content.taxa.filter((t) => t.category === c)] as const);

  return (
    <div className="stack">
      <h2>
        {row.vernacular_name ?? '이름 없음'} <IdStatusBadge status={row.id_status} />
        {row.hidden && <span className="badge">숨김{row.hidden_reason ? `: ${row.hidden_reason}` : ''}</span>}
      </h2>

      <div className="review-photos">
        {photos.map((p) => (
          <figure key={p.id} className={p.hidden ? 'is-hidden' : ''}>
            {p.url ? <img src={p.url} alt="기록 사진" /> : <div className="blob-missing">미리보기 없음</div>}
            <figcaption>
              {p.mediaSource === 'camera' ? '카메라' : '앨범'}
              {p.exifTime ? ` · EXIF ${formatTime(p.exifTime)}` : ''}
              <button className="btn btn--ghost btn--small" onClick={() => void act(() => admin.setPhotoHidden(p.id, !p.hidden))}>
                {p.hidden ? '사진 보이기' : '사진 숨기기'}
              </button>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="review-grid">
        <dl className="facts">
          <dt>관찰 시각</dt>
          <dd>
            {formatDate(row.observed_at)} {formatTime(row.observed_at)}
          </dd>
          <dt>가족</dt>
          <dd>{householdLabel(row.household_no)}</dd>
          <dt>조사 노력</dt>
          <dd>{row.effort_text ?? '탐험 진행 중'}</dd>
          <dt>가족 선택</dt>
          <dd>
            {familyPick} <span className="muted">({row.pick_source})</span>
          </dd>
          <dt>보여 준 후보</dt>
          <dd>{row.candidate_ids.map((id) => taxonById(content, id)?.koreanName ?? id).join(', ') || '–'}</dd>
          <dt>생물 위치</dt>
          <dd>
            {row.subject_lat.toFixed(6)}, {row.subject_lng.toFixed(6)} ± {row.radius_m}m
            <br />
            <span className="muted">
              {row.location_method === 'near_me' ? '내 근처' : '지도 탭'}
              {row.distance_m != null ? ` · 촬영자로부터 ${Math.round(row.distance_m)}m` : ''}
              {row.observer_accuracy_m != null ? ` · GPS 정확도 ${row.observer_accuracy_m}m` : ' · 촬영자 위치 없음'}
            </span>
          </dd>
          <dt>구역·서식환경</dt>
          <dd>
            {row.outside_park ? '공원 밖' : (row.zone_id ? `${row.zone_id} ${row.zone_name}` : '구역 밖')} · {row.biotope_code ? `${row.biotope_code} ${row.biotope_name}` : '비오톱 없음'}
          </dd>
        </dl>
        <div className="review-map">
          <ParkMap
            imageUrl={mapUrl}
            bounds={content.park.bounds}
            zones={content.zones}
            subject={{ lat: row.subject_lat, lng: row.subject_lng }}
            radiusM={row.radius_m}
            me={row.observer_lat != null && row.observer_lng != null ? { lat: row.observer_lat, lng: row.observer_lng, accuracy: row.observer_accuracy_m ?? 0, at: row.observed_at } : null}
            focus={{ lat: row.subject_lat, lng: row.subject_lng }}
            focusScale={2}
          />
        </div>
      </div>

      <section className="card stack">
        <h3>종 확정</h3>
        <div className="row row--wrap">
          <select value={taxonId} onChange={(e) => setTaxonId(e.target.value)} aria-label="종">
            <option value="">(종 없음)</option>
            {byCategory.map(([c, list]) => (
              <optgroup key={c} label={CATEGORY_LABEL[c]}>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.koreanName} · {t.scientificName}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input placeholder="사유(예: 사진상 이마판이 흰색)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="row row--wrap">
          {row.family_taxon_id && (
            <button className="btn btn--secondary" onClick={() => void review({ taxonId: row.family_taxon_id, status: 'reviewed', reason: reason || '가족 선택 확인' })}>
              가족 선택이 맞아요
            </button>
          )}
          <button className="btn btn--primary" disabled={!taxonId} onClick={() => void review({ taxonId, status: 'reviewed', reason })}>
            이 종으로 {ID_STATUS_LABEL.reviewed}
          </button>
          <button className="btn btn--secondary" onClick={() => void review({ status: 'undeterminable', reason: reason || '사진으로 판단 불가' })}>
            {ID_STATUS_LABEL.undeterminable}
          </button>
        </div>
        <label className="row">
          <span>심은 것 여부</span>
          {/* PRD 6장: establishmentMeans에 cultivated(정원 식재수)를 넣습니다. */}
          <select value={row.establishment_means ?? ''} onChange={(e) => void review({ establishmentMeans: e.target.value || null })}>
            <option value="">(비움)</option>
            <option value="cultivated">cultivated · 심은 것</option>
            <option value="native">native · 자생</option>
            <option value="uncertain">uncertain · 모름</option>
          </select>
        </label>
      </section>

      <section className="card stack">
        <h3>중복 후보 (같은 종 · 30m 안 · 10분 안)</h3>
        {row.duplicate_group_id && (
          <p>
            묶음 <code>{row.duplicate_group_id.slice(0, 8)}</code>{' '}
            <button className="btn btn--ghost btn--small" onClick={() => void act(() => admin.ungroup(row.id))}>
              이 기록 묶음에서 빼기
            </button>
          </p>
        )}
        {dupes.length === 0 ? (
          <p className="muted">후보가 없어요.</p>
        ) : (
          <>
            <ul className="plain-list">
              {dupes.map((d) => (
                <li key={d.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={checked.includes(d.id)}
                      onChange={(e) => setChecked(e.target.checked ? [...checked, d.id] : checked.filter((x) => x !== d.id))}
                    />
                    <span>
                      {householdLabel(d.household_no)} · {formatTime(d.observed_at)} · {d.vernacular_name}
                      {d.duplicate_group_id ? ` · 묶음 ${d.duplicate_group_id.slice(0, 8)}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn btn--secondary" disabled={!checked.length} onClick={() => void act(() => admin.groupDuplicates([row.id, ...checked]))}>
              같은 개체로 묶기
            </button>
          </>
        )}
      </section>

      <section className="card stack">
        <h3>숨기기</h3>
        {row.hidden ? (
          <button className="btn btn--secondary" onClick={() => void review({ hidden: false })}>
            숨김 풀기
          </button>
        ) : (
          <div className="row row--wrap">
            <input placeholder="사유(예: 얼굴 노출, 장난 기록)" value={hiddenReason} onChange={(e) => setHiddenReason(e.target.value)} />
            <button className="btn btn--danger" onClick={() => void review({ hidden: true, hiddenReason: hiddenReason || '검토자 숨김' })}>
              기록 숨기기
            </button>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <section className="stack">
        <h3>검토 이력</h3>
        <table className="table">
          <thead>
            <tr>
              <th>언제</th>
              <th>누가</th>
              <th>이전</th>
              <th>바뀐 값</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>
                  {formatDate(h.created_at)} {formatTime(h.created_at)}
                </td>
                <td>{h.actor === 'reviewer' ? '검토자' : '가족'}</td>
                <td>{h.previous_status ? `${h.previous_vernacular_name ?? '–'} / ${ID_STATUS_LABEL[h.previous_status]}` : '–'}</td>
                <td>
                  {h.vernacular_name ?? '–'} / {ID_STATUS_LABEL[h.status]}
                </td>
                <td>{h.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
