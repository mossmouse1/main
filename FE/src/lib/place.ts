import type { Content } from '../content/types';
import { distanceM, findZone, type LatLng } from './geo';

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

/** 기준점에서 본 방향(8방위) */
export function directionWord(from: LatLng, to: LatLng): string {
  const dy = to.lat - from.lat;
  const dx = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // 북 0°, 동 90°
  return DIRS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/**
 * 지금 걷는 곳을 아이도 알아듣게: ‘호수 북쪽 물가길’, ‘남서쪽 잔디밭 길’, ‘루나분수 근처’.
 * 방향은 호수 가운데(content.map.focus)에서 본 방향입니다.
 */
export function describePlace(content: Content, p: LatLng): { name: string; zoneId: string | null } {
  const zone = findZone(p, content.zones);
  const lake = content.map.focus ? { lat: content.map.focus[0], lng: content.map.focus[1] } : null;
  const dir = lake ? directionWord(lake, p) : '';
  const landmark = content.facilities
    .filter((f) => f.kind === 'place' || f.kind === 'peak')
    .map((f) => ({ f, d: distanceM(p, f) }))
    .sort((a, b) => a.d - b.d)[0];
  if (landmark && landmark.d < 70) return { name: `${landmark.f.name} 근처`, zoneId: zone?.id ?? null };
  const side = dir ? `${dir}쪽 ` : '';
  switch (zone?.id) {
    case 'Z1':
      return { name: '호수 위 다리', zoneId: 'Z1' };
    case 'Z2':
      return { name: `호수 ${side}물가길`, zoneId: 'Z2' };
    case 'Z3':
      return { name: `${side}숲길`, zoneId: 'Z3' };
    case 'Z4':
      return { name: `${side}정원 길`, zoneId: 'Z4' };
    case 'Z5':
      return { name: `${side}잔디밭 길`, zoneId: 'Z5' };
    default:
      return { name: '공원 가장자리', zoneId: zone?.id ?? null };
  }
}
