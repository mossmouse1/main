import L from 'leaflet';
import type { Geometry, Zone } from '../content/types';
import { inGeometry, type LatLng } from '../lib/geo';

function fieldOverlay(map: L.Map, bounds: L.LatLngBounds, toMap: (lat: number, lng: number) => L.LatLng) {
  const origin = map.project(bounds.getNorthWest(), 0);
  const size = map.project(bounds.getSouthEast(), 0).subtract(origin);
  const scale = 1600 / size.x;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 1600 ${size.y * scale}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const project = (p: LatLng) => map.project(toMap(p.lat, p.lng), 0).subtract(origin).multiplyBy(scale);
  return { svg, project };
}

function polygons(geometry: Geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

export function waterField(map: L.Map, bounds: L.LatLngBounds, toMap: (lat: number, lng: number) => L.LatLng, lake: Geometry) {
  const { svg, project } = fieldOverlay(map, bounds, toMap);
  const shore = L.latLngBounds(polygons(lake).flatMap(([outer]) => outer.map(([lng, lat]) => L.latLng(lat, lng))));
  const points: LatLng[] = [];
  const latStep = (shore.getNorth() - shore.getSouth()) / 11;
  const lngStep = (shore.getEast() - shore.getWest()) / 12;
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 12; col++) {
      const lat = shore.getSouth() + (row + 0.25 + ((col * 3 + row) % 7) * 0.07) * latStep;
      const lng = shore.getWest() + (col + 0.25 + ((row * 3 + col) % 7) * 0.07) * lngStep;
      if ((row + col) % 2 || !inGeometry({ lat, lng }, lake)) continue;
      // Keep the drifting details off the bank, even at the ends of their travel.
      if ([{ lat, lng: lng - 0.00019 }, { lat, lng: lng + 0.00019 }, { lat: lat - 0.00016, lng }, { lat: lat + 0.00016, lng }].every((p) => inGeometry(p, lake))) {
        points.push({ lat, lng });
      }
    }
  }
  svg.innerHTML = points.map((p, i) => {
    const { x, y } = project(p);
    const delay = `style="animation-delay:-${(i * 0.83) % 7}s"`;
    const detail = i % 5 === 0
      ? `<path class="field-leaf" ${delay} d="M-7 1Q-3 -7 7 -4Q5 5 -3 5L-8 6Z"/>`
      : i % 5 === 2
        ? `<ellipse class="field-ripple" ${delay} rx="17" ry="7"/>`
        : `<path class="field-glint" ${delay} d="M-24 0H7m5 0h7m-21 7h15"/>`;
    return `<g transform="translate(${x} ${y})">${detail}</g>`;
  }).join('');
  return L.svgOverlay(svg, bounds, { className: 'field-water', interactive: false }).addTo(map);
}

export function parkScan(map: L.Map, bounds: L.LatLngBounds, toMap: (lat: number, lng: number) => L.LatLng, zones: Zone[]) {
  const { svg, project } = fieldOverlay(map, bounds, toMap);
  const id = `park-scan-${L.stamp(map)}`;
  const parkBounds = L.bounds([]);
  const paths = zones.flatMap((zone) => polygons(zone.geometry).map((rings) => {
    const path = rings.map((ring) => {
      const points = ring.map(([lng, lat]) => project({ lat, lng }));
      for (const point of points) parkBounds.extend(point);
      return `M${points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
    }).join('');
    return `<path d="${path}"/>`;
  })).join('');
  if (!parkBounds.isValid()) return null;
  const size = parkBounds.getSize();
  const { x, y } = parkBounds.min!;
  const bandWidth = size.x * 0.6;
  svg.innerHTML = `<defs><clipPath id="${id}" clip-rule="evenodd">${paths}</clipPath><linearGradient id="${id}-beam"><stop stop-color="#a7ffe4" stop-opacity="0"/><stop offset="0.92" stop-color="#d4ffec" stop-opacity="0.42"/><stop offset="1" stop-color="#f2fff3" stop-opacity="0.75"/></linearGradient></defs>
    <g class="field-scan__boundary" fill-rule="evenodd">${paths}</g>
    <g clip-path="url(#${id})"><rect class="field-scan__beam" x="${x - bandWidth}" y="${y}" width="${bandWidth}" height="${size.y}" fill="url(#${id}-beam)" style="--scan-travel:${size.x + bandWidth}px"/></g>`;
  return L.svgOverlay(svg, bounds, { className: 'field-scan', interactive: false }).addTo(map);
}
