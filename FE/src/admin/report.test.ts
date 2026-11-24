import { describe, expect, it } from 'vitest';
import type { AdminRow } from '../backend/types';
import { appearances, isAlien, isOutOfDex, isUnverified, participantNumbers, recordRow, summarize } from './report';

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
