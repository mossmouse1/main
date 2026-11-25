import { describe, expect, it } from 'vitest';
import type { AdminRow } from '../backend/types';
import { appearances, biotopeSummary, countBy, inPeriod, isAlien, isOutOfDex, isUnverified, participantNumbers, radiusBin, recordRow, shortId, summarize, walkNumbers, walkSummary } from './report';

const row = (o: Partial<AdminRow>): AdminRow =>
  ({
    id: 'x', household_no: 1, observed_at: '2026-11-12T01:00:00Z', taxon_id: null, vernacular_name: null, scientific_name: null, free_text_name: null,
    id_status: 'family', pick_source: 'card', subject_lat: 37.1, subject_lng: 127.1, location_method: 'tap', zone_id: null, zone_name: '호수', outside_park: false,
    biotope_name: null, photo_paths: [], hidden: false, ...o,
  }) as AdminRow;

describe('보고서 집계', () => {
  const rows = [
    row({ id: 'a', household_no: 7, observed_at: '2026-11-12T05:00:00Z', taxon_id: 'survey-bluegill', vernacular_name: '블루길', photo_paths: ['p'] }),
    row({ id: 'b', household_no: 3, observed_at: '2026-11-12T01:00:00Z', taxon_id: 'survey-bluegill', vernacular_name: '블루길', zone_name: '숲' }),
    row({ id: 'c', household_no: 3, observed_at: '2026-11-13T01:00:00Z', pick_source: 'free_text', free_text_name: '이름모를 새' }),
  ];

  it('가족은 첫 기록 순서대로 번호를 받는다', () => {
    expect([...participantNumbers(rows)]).toEqual([[3, 1], [7, 2]]);
  });

  it('요약 숫자', () => {
    expect(summarize(rows)).toEqual({ records: 3, households: 2, species: 1, photoRate: 1 / 3 });
  });

  it('외래종은 종별로 묶고 처음·마지막 날짜(KST)와 구역을 낸다', () => {
    const [a] = appearances(rows, isAlien);
    expect(a).toMatchObject({ name: '블루길', count: 2, first: '2026-11-12', last: '2026-11-12', verified: false });
    expect(a.places).toBe('호수, 숲');
  });

  it('도감 밖 기록과 검증 전 배지 대상', () => {
    expect(rows.filter(isOutOfDex).map((r) => r.id)).toEqual(['c']);
    expect(isUnverified(rows[0])).toBe(true);
    expect(isUnverified(rows[2])).toBe(false);
  });

  it('전체 표 행에는 사진 경로·가족 id가 없다', () => {
    const x = recordRow(rows[0], 2, undefined);
    expect(JSON.stringify(x)).not.toMatch(/household|photo_paths/);
    expect(x).toMatchObject({ participant: '참여자 2', observedAt: '2026-11-12 14:00', photos: 1, alien: '예 (검증 전)' });
  });
});

describe('엑셀 보강용 집계', () => {
  const rows = [
    row({ id: 'abcdef12-0000', household_no: 7, observed_at: '2026-11-12T05:00:00Z', walk_id: 'w2', biotope_code: 'B1', biotope_name: '호수', taxon_id: 'survey-bluegill', vernacular_name: '블루길' }),
    row({ id: 'b', household_no: 3, observed_at: '2026-11-12T01:00:00Z', walk_id: 'w1', biotope_code: 'B1', biotope_name: '호수', taxon_id: 'spot-billed-duck', vernacular_name: '흰뺨검둥오리' }),
    row({ id: 'c', household_no: 3, observed_at: '2026-11-20T01:00:00Z', walk_id: 'w1', biotope_code: null, taxon_id: null }),
  ];

  it('참여자 번호는 전체 기준이라 기간을 좁혀도 같은 가족이 같은 번호', () => {
    const full = participantNumbers(rows);
    const early = rows.filter((r) => inPeriod(r, '', '2026-11-12')); // 가족 3과 7
    const onlyLater = rows.filter((r) => inPeriod(r, '2026-11-15', '')); // 가족 3만
    expect([...full]).toEqual([[3, 1], [7, 2]]);
    expect(early).toHaveLength(2);
    expect(onlyLater.map((r) => r.id)).toEqual(['c']);
    // 걸러낸 기록만으로 세면 번호가 달라지는 경우: 가족 7만 남기면 1번이 되어 버린다. 그래서 항상 전체(full)로 센다.
    expect(participantNumbers(rows.filter((r) => r.household_no === 7)).get(7)).toBe(1);
    expect(full.get(7)).toBe(2);
  });

  it('산책 번호는 시작 시각 순서, 산책 횟수·시간(분)', () => {
    const walks = [
      { id: 'w2', startedAt: '2026-11-12T05:00:00Z', endedAt: '2026-11-12T06:00:00Z', lastActivityAt: '2026-11-12T06:00:00Z' },
      { id: 'w1', startedAt: '2026-11-12T01:00:00Z', endedAt: null, lastActivityAt: '2026-11-12T01:30:00Z' },
      { id: 'w3', startedAt: '2026-11-13T01:00:00Z', endedAt: '2026-11-13T02:00:00Z', lastActivityAt: '2026-11-13T02:00:00Z' },
    ];
    expect([...walkNumbers(walks)]).toEqual([['w1', 1], ['w2', 2], ['w3', 3]]);
    expect(walkSummary(rows, walks)).toEqual({ count: 2, minutes: 90 }); // w1 30분(진행 중) + w2 60분, 기록 없는 w3은 제외
  });

  it('위치 오차 구간 경계', () => {
    expect([10, 11, 25, 26, 50, 51, null].map(radiusBin)).toEqual(['10m 이하', '10~25m', '10~25m', '25~50m', '25~50m', '50m 초과', '값 없음']);
  });

  it('건수 집계는 0건 항목도 남기고 비오톱 요약은 비오톱 없음으로 묶는다', () => {
    expect(countBy(rows, (r) => r.pick_source, ['card', 'free_text'])).toEqual([['card', 3], ['free_text', 0]]);
    const b = biotopeSummary(rows);
    expect(b[0]).toMatchObject({ code: 'B1', name: '호수', records: 2, species: 2, important: 1 });
    expect(b[1]).toMatchObject({ code: '', name: '비오톱 없음', records: 1, species: 0 });
  });

  it('기록 ID는 UUID 앞 8자리', () => {
    expect(shortId('abcdef12-3456-7890')).toBe('abcdef12');
  });
});
