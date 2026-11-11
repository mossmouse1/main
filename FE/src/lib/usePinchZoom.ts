import { useEffect, type RefObject } from 'react';
import { pinchZoom } from './zoom';

/**
 * 두 손가락 핀치로 배율을 바꿉니다(Pointer Events). 손가락을 떼면 그 배율이 유지됩니다.
 * 대상 요소에 touch-action: none이 있어야 브라우저 기본 확대·스크롤과 부딪치지 않습니다.
 */
export function usePinchZoom(el: RefObject<HTMLElement | null>, getZoom: () => number, setZoom: (z: number) => void, min: number, max: number): void {
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { dist: number; zoom: number } | null = null;
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) start = { dist: dist(), zoom: getZoom() };
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && start) setZoom(pinchZoom(start.zoom, start.dist, dist(), min, max));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      start = null; // 한 손가락이 남아도 새로 시작해야 값이 튀지 않습니다.
      if (pointers.size === 2) start = { dist: dist(), zoom: getZoom() };
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
  }, [el, getZoom, setZoom, min, max]);
}
