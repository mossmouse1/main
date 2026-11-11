import { debugInc } from './debug';
import { pinchZoom } from './zoom';

export interface PinchLatest {
  getZoom: () => number;
  setZoom: (z: number) => void;
  min: number;
  max: number;
}

/**
 * 핀치 제스처 처리(DOM 훅과 분리해 테스트합니다). attach(요소)를 부르면 리스너를 달고, 돌려준 함수로 뗍니다.
 * 배율 = 핀치 시작 배율 × (현재 간격 ÷ 시작 간격). 최신 값·범위는 latest()로 읽어서 배율이 바뀌어도 다시 달 필요가 없습니다.
 * iOS Safari는 gesture*(scale)도 쓰고 페이지 확대를 막습니다.
 */
export function attachPinch(node: EventTarget & { setPointerCapture?: (id: number) => void }, latest: () => PinchLatest): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { dist: number; zoom: number } | null = null;
  let gesture: number | null = null;
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const restart = () => {
    start = pointers.size === 2 ? { dist: dist(), zoom: latest().getZoom() } : null;
  };

  const down = (ev: Event) => {
    const e = ev as PointerEvent;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      node.setPointerCapture?.(e.pointerId);
    } catch {
      /* 일부 브라우저는 지원하지 않음 */
    }
    restart();
  };
  const move = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size !== 2 || !start || gesture !== null) return;
    debugInc('zoom.moves');
    const { setZoom, min, max } = latest();
    setZoom(pinchZoom(start.zoom, start.dist, dist(), min, max));
  };
  const up = (ev: Event) => {
    if (ev.type === 'pointercancel') debugInc('zoom.cancels');
    pointers.delete((ev as PointerEvent).pointerId);
    restart();
  };
  const gStart = (e: Event) => {
    e.preventDefault();
    gesture = latest().getZoom();
  };
  const gChange = (e: Event) => {
    e.preventDefault();
    if (gesture === null) return;
    debugInc('zoom.moves');
    const { setZoom, min, max } = latest();
    setZoom(pinchZoom(gesture, 1, (e as Event & { scale: number }).scale, min, max));
  };
  const gEnd = (e: Event) => {
    e.preventDefault();
    gesture = null;
  };

  const handlers: [string, (e: Event) => void][] = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['gesturestart', gStart],
    ['gesturechange', gChange],
    ['gestureend', gEnd],
  ];
  handlers.forEach(([t, h]) => node.addEventListener(t, h));
  return () => handlers.forEach(([t, h]) => node.removeEventListener(t, h));
}
