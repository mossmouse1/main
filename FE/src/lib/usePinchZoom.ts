import { useEffect, useRef } from 'react';
import { debugSet } from './debug';
import { attachPinch } from './pinchController';

/**
 * 두 손가락 핀치로 배율을 바꿉니다. element는 state(콜백 ref)로 받아야 합니다:
 * 대상 요소가 늦게 렌더돼도(데이터 로딩 뒤, 카메라 권한 뒤) 나타나는 순간 리스너가 달립니다.
 * 리스너는 요소가 바뀔 때만 다시 달고, 배율이 바뀌어도 건드리지 않습니다.
 */
export function usePinchZoom(element: HTMLElement | null, getZoom: () => number, setZoom: (z: number) => void, min: number, max: number): void {
  const latest = useRef({ getZoom, setZoom, min, max });
  latest.current = { getZoom, setZoom, min, max };

  useEffect(() => {
    debugSet('zoom.target', !!element);
    if (!element) {
      debugSet('zoom.attached', false);
      return;
    }
    const detach = attachPinch(element, () => latest.current);
    debugSet('zoom.attached', true);
    return () => {
      detach();
      debugSet('zoom.attached', false);
    };
  }, [element]);
}
