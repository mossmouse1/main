// 카메라 확대 계산(순수 함수). 제스처·캔버스와 분리해 단위 테스트합니다.

export const MAX_ZOOM = 5;
/** 캔버스 긴 변 상한. iOS Safari는 약 16.7MP(≈4096×4096)를 넘으면 캔버스가 실패합니다. */
export const MAX_CAPTURE_EDGE = 4096;

export const clampZoom = (z: number, min: number, max: number): number => (Number.isFinite(z) ? Math.min(max, Math.max(min, z)) : min);

/** 허용 범위: 최소 1×, 최대는 기기가 지원하는 값과 5× 중 작은 값 */
export function zoomLimits(hw: { min: number; max: number } | null): { min: number; max: number } {
  return hw ? { min: Math.max(1, hw.min), max: Math.min(MAX_ZOOM, hw.max) } : { min: 1, max: MAX_ZOOM };
}

/** 두 손가락 간격이 start → now로 바뀌면 시작 배율에 같은 비율을 곱합니다. */
export function pinchZoom(startZoom: number, startDist: number, nowDist: number, min: number, max: number): number {
  if (startDist <= 0) return clampZoom(startZoom, min, max);
  return clampZoom(startZoom * (nowDist / startDist), min, max);
}

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * 화면에 보이는 영역을 영상 원본 좌표로. 화면은 영상을 object-fit: cover로 채우고(가장자리가 잘림),
 * 디지털 확대는 그 가운데를 zoom배 확대하므로, 찍을 때도 같은 영역을 잘라야 보이는 것과 찍히는 것이 같습니다.
 */
export function visibleRect(vw: number, vh: number, viewW: number, viewH: number, zoom: number): Rect {
  const viewAspect = viewW > 0 && viewH > 0 ? viewW / viewH : vw / vh;
  let sw = vw;
  let sh = vh;
  if (vw / vh > viewAspect) sw = vh * viewAspect;
  else sh = vw / viewAspect;
  sw /= zoom;
  sh /= zoom;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
}

/** 긴 변이 maxEdge를 넘지 않게 줄인 출력 크기(정수, 최소 1) */
export function fitSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
