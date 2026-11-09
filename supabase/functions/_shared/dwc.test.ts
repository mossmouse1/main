import { describe, expect, it } from 'vitest';
import { DWC_COLUMNS, observationToDwc, toCsv, toKst, type ExportRow } from './dwc';

const row: ExportRow = {
  id: '11111111-1111-4111-8111-111111111111',
  walk_id: '22222222-2222-4222-8222-222222222222',
  observed_at: '2026-11-22T05:12:00Z',
  household_no: 42,
  vernacular_name: '물닭',
  scientific_name: 'Fulica atra',
  family_vernacular_name: '물닭',
  free_text_name: null,
  id_status: 'family',
  subject_lat: 37.1689,
  subject_lng: 127.1012,
  radius_m: 25,
  location_method: 'tap',
  distance_m: 44.6,
  observer_lat: 37.1685,
  observer_lng: 127.1008,
  observer_accuracy_m: 12,
  zone_id: 'Z1',
  zone_name: '수면·호소 섬',
  outside_park: false,
  biotope_code: 'DC2',
  biotope_name: '경관휴양호수',
  biotope_year: 2024,
  biotope_source: '경기기후플랫폼 비오톱',
  effort_text: '어른 1·아이 2 × 40분, Z1·Z4',
  establishment_means: null,
  date_identified: null,
  identification_remarks: null,
  duplicate_group_id: null,
  photo_paths: ['u/o/p-original.jpg'],
  hidden: false,
};

describe('Darwin Core 매핑', () => {
  it('한국 시간으로 날짜·시각을 쓴다', () => {
    expect(toKst('2026-11-22T05:12:00Z')).toEqual({ date: '2026-11-22', time: '14:12+09:00' });
    expect(toKst('2026-11-22T16:30:00Z').date).toBe('2026-11-23');
  });

  it('PRD 6장 예시 값과 같다', () => {
    const d = observationToDwc(row);
    expect(d.occurrenceID).toBe(row.id);
    expect(d.eventID).toBe(row.walk_id);
    expect(d.eventDate).toBe('2026-11-22');
    expect(d.eventTime).toBe('14:12+09:00');
    expect(d.recordedBy).toBe('가족-0042');
    expect(d.identificationVerificationStatus).toBe('추정(가족)');
    expect(d.decimalLatitude).toBe('37.168900');
    expect(d.coordinateUncertaintyInMeters).toBe('25');
    expect(d.georeferenceRemarks).toBe('지도 탭, 촬영자로부터 45m');
    expect(d.locality).toBe('동탄호수공원 Z1 수면·호소 섬');
    expect(d.habitat).toBe('DC2 경관휴양호수(경기기후플랫폼 비오톱 2024)');
    expect(d.samplingProtocol).toBe('자유 관찰(가족 산책)');
    expect(d.samplingEffort).toBe('어른 1·아이 2 × 40분, Z1·Z4');
    expect(d.basisOfRecord).toBe('HumanObservation');
    expect(d.municipality).toBe('화성시');
  });

  it('판단 불가는 이름을 비우고 가족 선택을 비고로 남긴다', () => {
    const d = observationToDwc({ ...row, id_status: 'undeterminable', date_identified: '2026-11-25T01:00:00Z' });
    expect(d.vernacularName).toBe('');
    expect(d.scientificName).toBe('');
    expect(d.identifiedBy).toBe('이끼마우스 검토자');
    expect(d.identificationRemarks).toContain('가족 선택: 물닭');
  });

  it('CSV는 BOM·CRLF로 시작하고, 쉼표·따옴표·수식을 막는다', () => {
    const csv = toCsv(['a', 'b'], [{ a: '물닭, "검둥"', b: '=1+1' }]);
    expect(csv.startsWith('﻿a,b\r\n')).toBe(true);
    expect(csv).toContain('"물닭, ""검둥"""');
    expect(csv).toContain("'=1+1");
  });

  it('기록 1건 = 1행, 열 이름은 Darwin Core 용어', () => {
    const csv = toCsv(DWC_COLUMNS, [observationToDwc(row)]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].replace('﻿', '').split(',')).toEqual([...DWC_COLUMNS]);
  });
});
