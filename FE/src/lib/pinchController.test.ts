import { describe, expect, it } from 'vitest';
import { attachPinch } from './pinchController';

const fire = (node: EventTarget, type: string, props: Record<string, unknown>) => node.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));
const ptr = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x, clientY: y });

function setup() {
  const state = { zoom: 1, sets: [] as number[] };
  const latest = () => ({ getZoom: () => state.zoom, setZoom: (z: number) => ((state.zoom = z), state.sets.push(z)), min: 1, max: 5 });
  return { state, latest };
}

describe('attachPinch', () => {
  it('요소가 늦게 나타나도(나중에 attach) 핀치가 동작한다', () => {
    const { state, latest } = setup();
    const node = new EventTarget(); // 처음엔 요소가 없다가, 데이터가 로드된 뒤 마운트되는 상황
    attachPinch(node, latest);
    fire(node, 'pointerdown', ptr(1, 0, 0));
    fire(node, 'pointerdown', ptr(2, 100, 0));
    fire(node, 'pointermove', ptr(2, 170, 0));
    expect(state.zoom).toBeCloseTo(1.7);
  });

  it('배율이 바뀌어도 제스처가 이어진다(리스너를 다시 달지 않음)', () => {
    const { state, latest } = setup();
    const node = new EventTarget();
    attachPinch(node, latest);
    fire(node, 'pointerdown', ptr(1, 0, 0));
    fire(node, 'pointerdown', ptr(2, 100, 0));
    for (const x of [120, 140, 160, 200]) fire(node, 'pointermove', ptr(2, x, 0));
    expect(state.sets).toHaveLength(4);
    expect(state.zoom).toBeCloseTo(2);
  });

  it('손가락을 떼면 배율을 유지하고, 다시 핀치하면 그 배율에서 이어간다', () => {
    const { state, latest } = setup();
    const node = new EventTarget();
    attachPinch(node, latest);
    fire(node, 'pointerdown', ptr(1, 0, 0));
    fire(node, 'pointerdown', ptr(2, 100, 0));
    fire(node, 'pointermove', ptr(2, 200, 0));
    fire(node, 'pointerup', ptr(2, 200, 0));
    fire(node, 'pointerup', ptr(1, 0, 0));
    expect(state.zoom).toBe(2);
    fire(node, 'pointerdown', ptr(3, 0, 0));
    fire(node, 'pointerdown', ptr(4, 100, 0));
    fire(node, 'pointermove', ptr(4, 150, 0));
    expect(state.zoom).toBeCloseTo(3);
  });

  it('한 손가락만으로는 배율이 바뀌지 않고, 범위를 넘지 않는다', () => {
    const { state, latest } = setup();
    const node = new EventTarget();
    attachPinch(node, latest);
    fire(node, 'pointerdown', ptr(1, 0, 0));
    fire(node, 'pointermove', ptr(1, 300, 0));
    expect(state.sets).toHaveLength(0);
    fire(node, 'pointerdown', ptr(2, 100, 0));
    fire(node, 'pointermove', ptr(2, 2000, 0));
    expect(state.zoom).toBe(5);
  });

  it('iOS gesture 이벤트는 scale로 배율을 정하고 페이지 확대(기본 동작)를 막는다', () => {
    const { state, latest } = setup();
    const node = new EventTarget();
    attachPinch(node, latest);
    fire(node, 'gesturestart', {});
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 2.5 });
    node.dispatchEvent(change);
    expect(state.zoom).toBe(2.5);
    expect(change.defaultPrevented).toBe(true);
    fire(node, 'gestureend', {});
  });

  it('떼어 내면 더 이상 반응하지 않는다', () => {
    const { state, latest } = setup();
    const node = new EventTarget();
    const detach = attachPinch(node, latest);
    detach();
    fire(node, 'pointerdown', ptr(1, 0, 0));
    fire(node, 'pointerdown', ptr(2, 100, 0));
    fire(node, 'pointermove', ptr(2, 200, 0));
    expect(state.sets).toHaveLength(0);
  });
});
