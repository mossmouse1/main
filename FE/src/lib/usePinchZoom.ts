import { useEffect, useRef, type RefObject } from 'react';
import { debugInc } from './debug';
import { pinchZoom } from './zoom';

/**
 * 두 손가락 핀치로 배율을 바꿉니다. 손가락을 떼면 그 배율이 유지됩니다.
 * - 배율 = 핀치 시작 배율 × (현재 두 손가락 간격 ÷ 시작 간격). 매번 시작값 기준이라 오차가 쌓이지 않습니다.
 * - 대상 요소에 touch-action: none이 있어야 합니다. 리스너는 한 번만 달고(배율이 바뀌어도 다시 달지 않음),
 *   최신 함수·범위는 ref로 읽습니다. (예전에는 렌더마다 리스너를 다시 달아 핀치 상태가 지워졌습니다.)
 * - iOS Safari는 gesture* 이벤트(scale)도 쓰고, 이때는 페이지 확대를 막습니다.
 */
export function usePinchZoom(el: RefObject<HTMLElement | null>, getZoom: () => number, setZoom: (z: number) => void, min: number, max: number): void {
  const latest = useRef({ getZoom, setZoom, min, max });
  latest.current = { getZoom, setZoom, min, max };

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { dist: number; zoom: number } | null = null;
    let gesture: number | null = null; // Safari gesture 시작 배율
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const restart = () => {
      start = pointers.size === 2 ? { dist: dist(), zoom: latest.current.getZoom() } : null;
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        node.setPointerCapture(e.pointerId); // 손가락이 버튼 위로 가도 이벤트를 놓치지 않게
      } catch {
        /* 일부 브라우저는 지원하지 않음 */
      }
      restart();
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2 || !start || gesture !== null) return;
      debugInc('zoom.moves');
      const { setZoom, min, max } = latest.current;
      setZoom(pinchZoom(start.zoom, start.dist, dist(), min, max));
    };
    const up = (e: PointerEvent) => {
      if (e.type === 'pointercancel') debugInc('zoom.cancels');
      pointers.delete(e.pointerId);
      restart(); // 한 손가락만 남았다가 다시 두 손가락이 되면 새로 시작(값이 튀지 않게)
    };

    const gStart = (e: Event) => {
      e.preventDefault();
      gesture = latest.current.getZoom();
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      if (gesture === null) return;
      debugInc('zoom.moves');
      const { setZoom, min, max } = latest.current;
      setZoom(pinchZoom(gesture, 1, (e as Event & { scale: number }).scale, min, max));
    };
    const gEnd = (e: Event) => {
      e.preventDefault();
      gesture = null;
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('gesturestart', gStart);
    node.addEventListener('gesturechange', gChange);
    node.addEventListener('gestureend', gEnd);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('gesturestart', gStart);
      node.removeEventListener('gesturechange', gChange);
      node.removeEventListener('gestureend', gEnd);
    };
  }, [el]);
}
