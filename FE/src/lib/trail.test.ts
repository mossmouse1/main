import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { clusterByPixels } from './cluster';
import { distanceM } from './geo';
import { describePlace, directionWord } from './place';
import { buildTrailGraph, pathLength, routeOnTrail, snapToTrail, type TrailLine } from './trail';

// 가로 200m 길 둘이 왼쪽 끝에서만 이어진 ‘ㄷ’자 모양(위 길 ↔ 아래 길은 왼쪽으로 돌아가야 함)
const LAT = 37.17;
const LNG = 127.1;
const dLng = (m: number) => m / (111_000 * Math.cos((LAT * Math.PI) / 180));
const dLat = (m: number) => m / 111_000;
const top: TrailLine = [
  [LAT + dLat(60), LNG],
  [LAT + dLat(60), LNG + dLng(200)],
];
const bottom: TrailLine = [
  [LAT, LNG],
  [LAT, LNG + dLng(200)],
];
const left: TrailLine = [
  [LAT, LNG],
  [LAT + dLat(60), LNG],
];

describe('산책로 길 안내', () => {
  const g = buildTrailGraph([top, bottom, left]);

  it('15m 간격으로 점을 채웁니다', () => {
    for (const [i, edges] of g.adj.entries()) for (const e of edges) expect(distanceM(g.pts[i], g.pts[e.to])).toBeLessThanOrEqual(15.5);
  });

  it('가장 가까운 길 점에 붙입니다', () => {
    const s = snapToTrail(g, { lat: LAT + dLat(5), lng: LNG + dLng(100) })!;
    expect(s.d).toBeLessThan(10);
    expect(s.point.lat).toBeCloseTo(LAT, 5);
  });

  it('길이 이어진 쪽으로 돌아서 갑니다', () => {
    const from = { lat: LAT + dLat(60), lng: LNG + dLng(20) };
    const to = { lat: LAT, lng: LNG + dLng(20) };
    const path = routeOnTrail(g, from, to)!;
    expect(path).not.toBeNull();
    // 직선 60m가 아니라 왼쪽 끝을 돌아 약 100m
    expect(pathLength(path)).toBeGreaterThan(90);
    expect(Math.min(...path.map((p) => p.lng))).toBeLessThan(LNG + dLng(5));
  });

  it('너무 돌아가면 null(직선으로 안내)', () => {
    const g2 = buildTrailGraph([top, bottom, left]);
    const from = { lat: LAT + dLat(60), lng: LNG + dLng(200) };
    const to = { lat: LAT, lng: LNG + dLng(200) };
    // 직선 60m, 길로 460m → 3배 + 60m 넘음
    expect(routeOnTrail(g2, from, to)).toBeNull();
  });

  it('12m 안의 다른 길은 갈림길로 잇습니다', () => {
    const near: TrailLine = [
      [LAT + dLat(8), LNG + dLng(100)],
      [LAT + dLat(40), LNG + dLng(100)],
    ];
    const g3 = buildTrailGraph([bottom, near]);
    const path = routeOnTrail(g3, { lat: LAT, lng: LNG + dLng(20) }, { lat: LAT + dLat(40), lng: LNG + dLng(100) });
    expect(path).not.toBeNull();
  });
});

describe('사진 핀 묶기', () => {
  it('가까운 핀은 묶고 우선순위 높은 핀이 대표가 됩니다', () => {
    const out = clusterByPixels(
      [
        { x: 0, y: 0, priority: 1, item: 'a' },
        { x: 10, y: 0, priority: 5, item: 'b' },
        { x: 200, y: 0, priority: 1, item: 'c' },
      ],
      40,
    );
    expect(out).toHaveLength(2);
    expect(out[0].items).toEqual(['b', 'a']);
    expect(out[0].x).toBe(10);
  });
});

describe('지금 걷는 곳', () => {
  const content = JSON.parse(readFileSync(new URL('../../public/content/v1.json', import.meta.url), 'utf8')) as Content;
  const lake = { lat: content.map.focus![0], lng: content.map.focus![1] };

  it('8방위', () => {
    expect(directionWord(lake, { lat: lake.lat + 0.001, lng: lake.lng })).toBe('북');
    expect(directionWord(lake, { lat: lake.lat, lng: lake.lng - 0.001 })).toBe('서');
    expect(directionWord(lake, { lat: lake.lat - 0.001, lng: lake.lng + 0.0012 })).toBe('남동');
  });

  it('호숫가 띠(Z2)는 ‘호수 ○쪽 물가길’', () => {
    // 모든 관찰 지점 중 Z2에 있는 점 하나
    const spot = content.taxa.flatMap((t) => t.sightings ?? []).find(([lat, lng]) => describePlace(content, { lat, lng }).zoneId === 'Z2');
    expect(spot).toBeTruthy();
    expect(describePlace(content, { lat: spot![0], lng: spot![1] }).name).toMatch(/^(호수 .+쪽 물가길|.+ 근처)$/);
  });

  it('관찰 지점은 모두 지도 범위 안에 있습니다', () => {
    const b = content.park.bounds;
    for (const t of content.taxa) {
      for (const [lat, lng] of t.sightings ?? []) {
        expect(lat > b.south && lat < b.north && lng > b.west && lng < b.east).toBe(true);
      }
    }
  });
});
