import type { Content, Taxon } from '../content/types';

/** 지금 달이 기록이 많은 달이면 ‘찾기 좋은 때’ */
export function seasonHint(counts: number[] | null, month = new Date().getMonth()): { text: string; good: boolean } | null {
  if (!counts) return null;
  const max = Math.max(...counts);
  if (max === 0) return { text: '아직 기록이 적어요', good: false };
  const near = [counts[(month + 11) % 12], counts[month], counts[(month + 1) % 12]];
  if (counts[month] >= max * 0.5 || Math.max(...near) >= max * 0.75) return { text: '지금이 찾기 좋은 때', good: true };
  if (counts[month] === 0) return { text: '이맘때는 기록이 드물어요', good: false };
  return { text: '가끔 기록돼요', good: false };
}

/** 이 공원 주변 월별 기록 막대. 기준(2020년 이후, 반경 1.5km, 출처)을 항상 같이 보여 줍니다. */
export function MonthBars({ taxon, content }: { taxon: Taxon; content: Content }) {
  const counts = taxon.monthCounts;
  const caption = `${content.monthCounts.basis} · ${content.monthCounts.source}`;
  if (!counts) {
    return (
      <div className="months months--empty">
        <p>월별 기록 자료가 아직 없어요.</p>
        <p className="caption">{caption}</p>
      </div>
    );
  }
  const total = taxon.recordCount ?? counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  const thisMonth = new Date().getMonth();
  const hint = seasonHint(counts, thisMonth);
  return (
    <div className="months">
      <div className="months__head">
        <span>
          주변 공개 기록 <strong>{total}건</strong>
        </span>
        {hint && <span className={hint.good ? 'months__hint is-good' : 'months__hint'}>{hint.text}</span>}
      </div>
      <ol className="months__bars" aria-label={`월별 공개 기록: ${counts.map((n, i) => `${i + 1}월 ${n}건`).join(', ')}`}>
        {counts.map((n, i) => (
          <li key={i} className={i === thisMonth ? 'is-now' : n ? undefined : 'is-zero'}>
            <span className="months__bar" style={{ height: n ? `${Math.max(8, (n / max) * 100)}%` : '2px' }} />
            <span className="months__label" aria-hidden="true">
              {i + 1}
            </span>
          </li>
        ))}
      </ol>
      <p className="caption">{caption}</p>
    </div>
  );
}
