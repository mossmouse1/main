// ?debug=1 진단. 켜졌을 때만 값을 모읍니다. 숫자·상태값만 담고 사진 내용·위치·키는 넣지 않습니다.
import { useSyncExternalStore } from 'react';

function detect(): boolean {
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') sessionStorage.setItem('debug', '1');
    return sessionStorage.getItem('debug') === '1'; // 화면을 옮겨도(쿼리가 사라져도) 이 탭에서는 유지
  } catch {
    return new URLSearchParams(location.search).get('debug') === '1';
  }
}
export const DEBUG = typeof location !== 'undefined' && detect();

type Value = string | number | boolean;
let data: Record<string, Value> = {};
const listeners = new Set<() => void>();
const emit = () => {
  data = { ...data };
  listeners.forEach((l) => l());
};

export function debugSet(key: string, value: Value): void {
  if (!DEBUG || data[key] === value) return;
  data[key] = value;
  emit();
}
export function debugInc(key: string): void {
  if (!DEBUG) return;
  data[key] = ((data[key] as number) ?? 0) + 1; // 카운터는 렌더를 부르지 않고 쌓다가 패널이 1초마다 읽습니다.
}
export const debugGet = (key: string): Value | undefined => data[key];

export function useDebugData(): Record<string, Value> {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => data,
  );
}
