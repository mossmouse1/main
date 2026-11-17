import type { LatLng } from './geo';

/**
 * 쿼터뷰 블록 지도의 좌표 변환 값(content.map.iso, scripts/build-iso.mjs가 적음).
 * 남동쪽 하늘에서 내려다본 2:1 쿼터뷰: 북쪽이 화면 오른쪽 위, 동쪽이 오른쪽 아래입니다.
 *   동 = (lng − lng0) × mLng,  남 = (lat0 − lat) × mLat
 *   화면 x = (동 − 남) − x0,  화면 y = (동 + 남) / 2 − y0
 */
export interface IsoSpec {
  image: string;
  width: number;
  height: number;
  lat0: number;
  lng0: number;
  mLat: number;
  mLng: number;
  x0: number;
  y0: number;
  /** 그림이 바뀌면 달라지는 값(기기에 둔 사본을 새로 받게 함) */
  rev?: string;
}

/** 위경도(땅 위의 점) → 그림 좌표(px) */
export function isoProject(s: IsoSpec, p: LatLng): { x: number; y: number } {
  const east = (p.lng - s.lng0) * s.mLng;
  const south = (s.lat0 - p.lat) * s.mLat;
  return { x: east - south - s.x0, y: (east + south) / 2 - s.y0 };
}

/** 그림 좌표(px) → 위경도. 땅 높이의 점으로 봅니다(나무·건물 위를 눌러도 그 뒤 땅의 자리). */
export function isoUnproject(s: IsoSpec, x: number, y: number): LatLng {
  const X = x + s.x0;
  const Y = y + s.y0;
  const east = (X + 2 * Y) / 2;
  const south = (2 * Y - X) / 2;
  return { lat: s.lat0 - south / s.mLat, lng: s.lng0 + east / s.mLng };
}

/** 나침반 방위(북 0°, 시계 방향) → 쿼터뷰 화면에서의 방향(위 0°, 시계 방향) */
export function isoBearing(headingDeg: number): number {
  const t = (headingDeg * Math.PI) / 180;
  const east = Math.sin(t);
  const south = -Math.cos(t);
  const x = east - south;
  const y = (east + south) / 2;
  return ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
}
