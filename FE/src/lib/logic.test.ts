import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeSeason, candidatesFromTaxon, candidatesFromZone, questSpecies } from '../content/helpers';
import type { Content } from '../content/types';
import { computeDex } from './dex';
import { effortText } from './effort';
import { distanceM, findBiotope, findZone, inBounds } from './geo';

const content = JSON.parse(readFileSync(new URL('../../public/content/v1.json', import.meta.url), 'utf8')) as Content;

describe('조사 노력 문구', () => {
  it('PRD 형식을 따른다', () => {
    expect(effortText({ adults: 1, children: 2, minutes: 40, zoneIds: ['Z4', 'Z1', 'Z1'] })).toBe('어른 1·아이 2 × 40분, Z1·Z4');
  });
  it('사람 수를 건너뛰면 인원 미입력, 구역이 없으면 생략', () => {
    expect(effortText({ adults: null, children: null, minutes: 5, zoneIds: [] })).toBe('인원 미입력 × 5분');
  });
});

describe('위치 계산', () => {
  it('거리는 위도 0.001도 ≈ 111m', () => {
    expect(distanceM({ lat: 37.168, lng: 127.1 }, { lat: 37.169, lng: 127.1 })).toBeCloseTo(111.2, 0);
  });
  it('구역 중심은 그 구역으로, 호수 안은 Z1과 DC2로 판정된다', () => {
    for (const z of content.zones) expect(findZone({ lat: z.center[0], lng: z.center[1] }, content.zones)?.id).toBe(z.id);
    const lake = { lat: content.zones[0].center[0], lng: content.zones[0].center[1] };
    expect(findBiotope(lake, content.biotopes, content.park.biotopeQueryBounds)?.code).toBe('DC2');
  });
  it('공원 밖 판정', () => {
    expect(inBounds({ lat: 37.2, lng: 127.1 }, content.park.bounds)).toBe(false);
    expect(findZone({ lat: 37.2, lng: 127.1 }, content.zones)).toBeNull();
  });
});

describe('후보 3개', () => {
  it('카드에서 시작하면 그 종 + 헷갈리는 종 2개이고, 같은 기록에서는 순서가 같다', () => {
    const a = candidatesFromTaxon(content, 'eurasian-coot', 'draft-1');
    expect([...a].sort()).toEqual(['common-moorhen', 'eurasian-coot', 'spot-billed-duck']);
    expect(candidatesFromTaxon(content, 'eurasian-coot', 'draft-1')).toEqual(a);
  });
  it('구역에서 시작하면 그 구역 후보 3개', () => {
    const season = activeSeason(content, new Date('2026-11-22T05:00:00Z'));
    const ids = candidatesFromZone(content, 'Z4', season, 'x');
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(content.taxa.find((t) => t.id === id)?.clue.zoneIds).toContain('Z4');
  });
});

describe('가족 도감', () => {
  const pool = activeSeason(content, new Date('2026-11-22T05:00:00Z'));
  const autumn = { ...pool, dex: pool.dex.slice(0, 10) };
  const obs = (taxonId: string | null, extra = {}) => ({
    id: Math.random().toString(),
    taxonId,
    observedAt: '2026-11-22T05:00:00Z',
    hidden: false,
    outsidePark: false,
    zoneId: 'Z2',
    photoIds: ['photo'],
    reviewChanged: false,
    reviewSeen: true,
    ...extra,
  });

  it('11월은 가을 퀘스트, 한국 시간 12월 1일부터 겨울 퀘스트', () => {
    expect(autumn.id).toBe('autumn-2026');
    expect(computeDex(content, autumn, [], []).total).toBe(10);
    expect(activeSeason(content, new Date('2026-11-30T14:59:59Z')).id).toBe('autumn-2026');
    expect(activeSeason(content, new Date('2026-11-30T15:00:00Z')).id).toBe('winter-2026');
  });
  it('가족별 계절 후보에서 중복 없이 10종을 선택한다', () => {
    const first = questSpecies(content, pool, 'family-a');
    expect(new Set(first).size).toBe(10);
    expect(first.every((id) => pool.dex.includes(id))).toBe(true);
    expect(questSpecies(content, pool, 'family-a')).toEqual(first);
    expect(questSpecies(content, pool, 'family-b')).not.toEqual(first);
  });
  it('다른 계절의 사진과 미확인 사진이 개인 도감에 남는다', () => {
    const dex = computeDex(content, autumn, [
      obs('eurasian-coot', { observedAt: '2026-02-20T01:00:00Z' }),
      obs(null, { id: 'my-unidentified', freeTextName: '내가 본 새' }),
    ], []);
    expect(dex.filled).toBe(0);
    expect(dex.collectionFoundIds.has('eurasian-coot')).toBe(true);
    expect(dex.unnamed[0]).toMatchObject({ id: 'my-unidentified', name: '내가 본 새' });
  });
  it('고른 기록이 있으면 칸이 차고 NEW가 붙는다. 숨긴 기록과 계절 밖 기록은 세지 않는다', () => {
    const dex = computeDex(
      content,
      autumn,
      [obs('eurasian-coot'), obs('oriental-magpie', { hidden: true }), obs('cornelian-cherry', { observedAt: '2026-12-05T05:00:00Z' }), obs(null)],
      [],
    );
    expect(dex.filled).toBe(1);
    expect(dex.cells.find((c) => c.taxon.id === 'eurasian-coot')?.isNew).toBe(true);
    expect(dex.nextClue?.id).toBe('spot-billed-duck');
  });
  it('이미 본 칸은 NEW가 아니고, 검토로 바뀐 칸은 표시된다', () => {
    const dex = computeDex(content, autumn, [obs('eurasian-coot', { reviewChanged: true, reviewSeen: false })], ['eurasian-coot']);
    const cell = dex.cells.find((c) => c.taxon.id === 'eurasian-coot')!;
    expect(cell.isNew).toBe(false);
    expect(cell.changedByReview).toBe(true);
  });
  it('검토로 도감 밖 종으로 바뀌어 칸이 비어도 알림 수에 잡힌다', () => {
    const dex = computeDex(content, autumn, [obs('common-moorhen', { reviewChanged: true, reviewSeen: false })], []);
    expect(dex.filled).toBe(0);
    expect(dex.changedUnseen).toBe(1);
  });
  it('공원에서 찍은 각 종 사진이 있어야 완료 날짜와 사진 목록을 만든다', () => {
    const partial = autumn.dex.slice(0, -1).map((id) => obs(id, { photoIds: [id] }));
    const last = autumn.dex.at(-1)!;
    expect(computeDex(content, autumn, [...partial, obs(last, { outsidePark: true }), obs(last, { zoneId: 'Z6' }), obs(last, { photoIds: [] })], []).completion).toBeNull();
    const completedAt = '2026-11-24T06:00:00Z';
    const dex = computeDex(content, autumn, [...partial, obs(last, { observedAt: completedAt, photoIds: [last] })], []);
    expect(dex.completion?.completedAt).toBe(completedAt);
    expect(dex.completion?.entries.map((entry) => entry.photoIds[0])).toEqual(autumn.dex);
  });
});
