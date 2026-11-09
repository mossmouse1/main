import type { Biotope, Bounds, Geometry, Zone } from '../content/types';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function inBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

/** GeoJSON 링([lng, lat][]) 안에 점이 있는지 */
function inRing(p: LatLng, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p: LatLng, rings: number[][][]): boolean {
  if (!inRing(p, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(p, hole));
}

export function inGeometry(p: LatLng, g: Geometry): boolean {
  return g.type === 'Polygon' ? inPolygon(p, g.coordinates) : g.coordinates.some((poly) => inPolygon(p, poly));
}

/** 구역은 배열 순서가 우선순위입니다(서버의 zones.priority와 같음). */
export function findZone(p: LatLng, zones: Zone[]): Zone | null {
  return zones.find((z) => inGeometry(p, z.geometry)) ?? null;
}

/** 비오톱 조회 범위 밖이면 null(‘범위 밖’) */
export function findBiotope(p: LatLng, biotopes: Biotope[], queryBounds: Bounds): Biotope | null {
  if (!inBounds(p, queryBounds)) return null;
  return biotopes.find((b) => inGeometry(p, b.geometry)) ?? null;
}

/** GeoJSON → Leaflet용 [lat, lng] 링 목록 */
export function geometryToLatLngs(g: Geometry): [number, number][][] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map((rings) => rings[0].map(([lng, lat]) => [lat, lng] as [number, number]));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `약 ${Math.round(m / 5) * 5}m`;
  return `약 ${(m / 1000).toFixed(1)}km`;
}
