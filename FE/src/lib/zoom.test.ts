import { describe, expect, it } from 'vitest';
import { clampZoom, fitSize, pinchZoom, visibleRect, zoomLimits } from './zoom';

describe('zoom 범위', () => {
  it('하드웨어 줌이 없으면 1~5, 있으면 기기 값과 5 중 작은 값', () => {
    expect(zoomLimits(null)).toEqual({ min: 1, max: 5 });
    expect(zoomLimits({ min: 1, max: 10 })).toEqual({ min: 1, max: 5 });
    expect(zoomLimits({ min: 0.5, max: 3 })).toEqual({ min: 1, max: 3 });
  });
  it('범위 밖·잘못된 값을 잘라 낸다', () => {
    expect(clampZoom(9, 1, 5)).toBe(5);
    expect(clampZoom(0.2, 1, 5)).toBe(1);
    expect(clampZoom(NaN, 1, 5)).toBe(1);
  });
  it('핀치: 간격 비율만큼 곱하고 범위를 지킨다', () => {
    expect(pinchZoom(1, 100, 170, 1, 5)).toBeCloseTo(1.7);
    expect(pinchZoom(2, 100, 50, 1, 5)).toBe(1);
    expect(pinchZoom(3, 100, 400, 1, 5)).toBe(5);
    expect(pinchZoom(2, 0, 100, 1, 5)).toBe(2);
  });
});

describe('visibleRect', () => {
  it('화면과 영상 비율이 같으면 zoom만큼 가운데를 자른다', () => {
    expect(visibleRect(4000, 3000, 400, 300, 2)).toEqual({ sx: 1000, sy: 750, sw: 2000, sh: 1500 });
  });
  it('세로로 긴 화면에 가로 영상이면 양옆이 먼저 잘린다(cover)', () => {
    const r = visibleRect(4000, 3000, 300, 600, 1);
    expect(r.sh).toBe(3000);
    expect(r.sw).toBe(1500);
    expect(r.sx).toBe(1250);
  });
  it('가로로 긴 화면에 세로 영상이면 위아래가 잘린다', () => {
    const r = visibleRect(3000, 4000, 600, 300, 2);
    expect(r.sw).toBe(1500);
    expect(r.sh).toBe(750);
  });
});

describe('fitSize', () => {
  it('상한 이하면 그대로, 넘으면 비율을 지켜 줄인다', () => {
    expect(fitSize(3000, 2000, 4096)).toEqual({ w: 3000, h: 2000 });
    expect(fitSize(8000, 6000, 4096)).toEqual({ w: 4096, h: 3072 });
  });
});
