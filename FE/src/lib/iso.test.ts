import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { isoBearing, isoProject, isoUnproject } from './iso';

const content = JSON.parse(readFileSync(new URL('../../public/content/v1.json', import.meta.url), 'utf8')) as Content;
const spec = content.map.iso!;

describe('쿼터뷰 블록 지도 좌표', () => {
  it('콘텐츠에 변환 값이 있습니다', () => {
    expect(spec).toBeTruthy();
    expect(spec.width).toBeGreaterThan(0);
    expect(spec.height).toBeGreaterThan(0);
  });

  it('위경도 → 그림 좌표 → 위경도가 제자리로 돌아옵니다', () => {
    const p = { lat: 37.1672, lng: 127.0983 };
    const { x, y } = isoProject(spec, p);
    const back = isoUnproject(spec, x, y);
    expect(back.lat).toBeCloseTo(p.lat, 7);
    expect(back.lng).toBeCloseTo(p.lng, 7);
  });

  it('북쪽은 오른쪽 위, 동쪽은 오른쪽 아래', () => {
    const c = { lat: spec.lat0, lng: spec.lng0 };
    const o = isoProject(spec, c);
    const north = isoProject(spec, { lat: c.lat + 0.001, lng: c.lng });
    const east = isoProject(spec, { lat: c.lat, lng: c.lng + 0.001 });
    expect(north.x).toBeGreaterThan(o.x);
    expect(north.y).toBeLessThan(o.y);
    expect(east.x).toBeGreaterThan(o.x);
    expect(east.y).toBeGreaterThan(o.y);
    expect(isoBearing(0)).toBeCloseTo(63.43, 1); // 북
    expect(isoBearing(90)).toBeCloseTo(116.57, 1); // 동
  });

  it('공원 범위와 모든 관찰 지점이 그림 안에 들어옵니다(끌어도 여백이 없도록 그림이 공원을 다 덮음)', () => {
    const b = content.park.bounds;
    const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= spec.width && p.y >= 0 && p.y <= spec.height;
    // 호수·공원 구역(Z1~Z5)의 모든 꼭짓점
    for (const z of content.zones.filter((q) => q.id !== 'Z6')) {
      const polys = z.geometry.type === 'Polygon' ? [z.geometry.coordinates] : z.geometry.coordinates;
      for (const [lng, lat] of polys.flat(2) as [number, number][]) expect(inside(isoProject(spec, { lat, lng }))).toBe(true);
    }
    for (const t of content.taxa) for (const [lat, lng] of t.sightings ?? []) expect(inside(isoProject(spec, { lat, lng }))).toBe(true);
    // 그림 범위(네 모서리) 가운데는 그림 한가운데 근처
    const mid = isoProject(spec, { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 });
    expect(inside(mid)).toBe(true);
  });
});
