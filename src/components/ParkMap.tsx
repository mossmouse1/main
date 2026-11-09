import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Bounds, Category, Facility, Zone } from '../content/types';
import type { ObserverFix } from '../data/types';
import { geometryToLatLngs, type LatLng } from '../lib/geo';
import { categoryIconSvg } from './CategoryIcon';

export interface SpeciesPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  category: Category;
  found: boolean;
  /** 찾은 종은 사진 핀, 못 찾은 종은 실루엣 핀 */
  photo?: string | null;
}

interface Props {
  imageUrl: string;
  bounds: Bounds;
  attribution?: string;
  zones?: Zone[];
  showZones?: boolean;
  /** outline: 점선 경계(위치 고르기·검토), label: 구역 이름표(지도 홈) */
  zoneMode?: 'outline' | 'label';
  /** 구역 이름표를 누르면(지도 홈) */
  onZoneClick?: (id: string) => void;
  speciesPins?: SpeciesPin[];
  selectedId?: string | null;
  onSpeciesClick?: (id: string) => void;
  facilities?: Facility[];
  me?: ObserverFix | null;
  subject?: LatLng | null;
  radiusM?: number;
  /** 내 위치 → 생물 핀 점선(‘이곳으로 걷기’)과 가운데 이름표(예: 도보 약 6분) */
  route?: { from: LatLng; to: LatLng } | null;
  routeLabel?: string;
  /** 내 위치 점 아래 이름표 */
  meLabel?: string;
  /** 지도를 탭하면(생물 위치 고르기, 빈 곳 누르기). 공원 그림 밖은 무시합니다. */
  onMapClick?: (p: LatLng) => void;
  /** 처음에 가운데 둘 곳과 확대 배율(1~4배) */
  focus?: LatLng | null;
  focusScale?: number;
  /** 값이 바뀌면 이 위치로 이동(exact: 지금보다 작은 배율로도 돌아감, 나침반) */
  flyTo?: { to: LatLng; key: number; scale?: number; exact?: boolean } | null;
  /** 지도 위·아래가 머리글·시트에 가려지는 높이(px). 가운데에 둘 때 보이는 영역 기준으로 맞춥니다. */
  topInset?: number;
  bottomInset?: number;
  scale?: boolean;
  className?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const htmlIcon = (html: string) => L.divIcon({ className: 'map-icon', html, iconSize: [0, 0] });

/**
 * 그림 지도 이미지 1장을 실제 좌표에 맞춰 올립니다(타일 서버 없음).
 * 확대는 공원 전체가 보이는 배율의 1~4배, 이동은 공원 범위 안으로 묶습니다.
 */
export function ParkMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fitZoom = useRef(0);
  const groups = useRef<Record<'zones' | 'facilities' | 'species' | 'me' | 'subject' | 'route', L.LayerGroup> | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const { imageUrl, bounds, attribution, scale } = props;
  useEffect(() => {
    const b = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
    const map = L.map(el.current!, {
      zoomControl: false,
      attributionControl: false,
      // 시트에 가린 아래쪽도 위로 끌어올려 볼 수 있게 여유를 둡니다.
      maxBounds: b.pad(0.3),
      maxBoundsViscosity: 1,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      bounceAtZoomLimits: false,
    });
    L.imageOverlay(imageUrl, b, { alt: '동탄호수공원 지도' }).addTo(map);
    if (attribution) L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution(attribution).addTo(map);
    if (scale) L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 90 }).addTo(map);

    // 화면이 공원 그림보다 가로로 넓으면 가로를 채우고(세로 스크롤), 아니면 그림 전체가 보이게 합니다.
    const applyZoomLimits = () => {
      const size = map.getSize();
      const fitWidth = map.getBoundsZoom(L.latLngBounds([b.getCenter().lat, b.getWest()], [b.getCenter().lat, b.getEast()]), false);
      const fitAll = map.getBoundsZoom(b);
      const fit = size.x / size.y > W_H_RATIO ? fitWidth : fitAll;
      if (!Number.isFinite(fit)) return; // 아직 크기가 0인 경우
      fitZoom.current = fit;
      // setMinZoom/setMaxZoom은 확대 애니메이션을 시작해서, 그사이 지도가 사라지면 오류가 납니다. 바로 적용합니다.
      map.options.minZoom = fit;
      map.options.maxZoom = fit + 2; // 2^2 = 4배
      const z = map.getZoom();
      if (z < fit || z > fit + 2) map.setZoom(Math.min(Math.max(z, fit), fit + 2), { animate: false });
    };
    map.fitBounds(b);
    applyZoomLimits();
    const { focus, focusScale = 1, topInset = 0, bottomInset = 0 } = latest.current;
    const z0 = fitZoom.current + Math.log2(focusScale);
    if (focus && b.contains(focus)) {
      // 머리글과 시트 사이(보이는 영역) 한가운데에 오게 합니다.
      const shifted = map.project([focus.lat, focus.lng], z0).add([0, (bottomInset - topInset) / 2]);
      map.setView(map.unproject(shifted, z0), z0, { animate: false });
    } else map.setView(b.getCenter(), fitZoom.current, { animate: false });

    groups.current = {
      zones: L.layerGroup(),
      facilities: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      species: L.layerGroup().addTo(map),
      me: L.layerGroup().addTo(map),
      subject: L.layerGroup().addTo(map),
    };
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (b.contains(e.latlng)) latest.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    // 이름표는 조금 확대했을 때만(전체 화면에서는 핀끼리 겹침). 생물 이름이 먼저, 지명은 더 확대했을 때.
    const toggleLabels = () => {
      const c = map.getContainer();
      c.classList.toggle('show-pin-labels', map.getZoom() >= fitZoom.current + 0.25);
      c.classList.toggle('is-zoomed', map.getZoom() >= fitZoom.current + 0.9);
    };
    map.on('zoomend', toggleLabels);
    toggleLabels();

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      applyZoomLimits();
      toggleLabels();
    });
    ro.observe(el.current!);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      // 이동 애니메이션 중에 화면을 떠나도 남은 프레임이 지도를 건드리지 않게 먼저 멈춥니다.
      map.stop();
      map.remove();
      mapRef.current = null;
      groups.current = null;
    };
  }, [imageUrl, bounds, attribution, scale]);

  const { zones, onZoneClick, showZones = true, zoneMode = 'outline' } = props;
  useEffect(() => {
    const g = groups.current?.zones;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    for (const zone of zones ?? []) {
      if (zoneMode === 'outline') {
        L.polygon(geometryToLatLngs(zone.geometry), {
          color: '#1f4d36',
          weight: 1.5,
          opacity: 0.55,
          dashArray: '4 6',
          fill: false,
          interactive: false,
        }).addTo(g);
      } else {
        L.marker(zone.center, {
          icon: htmlIcon(`<span class="map-zone">${esc(zone.name)}</span>`),
          title: `${zone.id} ${zone.name}`,
          interactive: !!onZoneClick,
          keyboard: !!onZoneClick,
          zIndexOffset: -500,
        })
          .on('click', () => latest.current.onZoneClick?.(zone.id))
          .addTo(g);
      }
    }
    if (showZones) g.addTo(map);
    else g.remove();
  }, [zones, onZoneClick, showZones, zoneMode]);

  const { facilities } = props;
  useEffect(() => {
    const g = groups.current?.facilities;
    if (!g) return;
    g.clearLayers();
    for (const f of facilities ?? []) {
      L.marker([f.lat, f.lng], { icon: htmlIcon(`<span class="map-label map-label--${f.kind ?? 'place'}">${esc(f.name)}</span>`), interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(g);
    }
  }, [facilities]);

  const { speciesPins, selectedId } = props;
  useEffect(() => {
    const g = groups.current?.species;
    if (!g) return;
    g.clearLayers();
    for (const pin of speciesPins ?? []) {
      const selected = pin.id === selectedId;
      const face =
        pin.found && pin.photo
          ? `<img src="${esc(pin.photo)}" alt="" loading="lazy" decoding="async"/>`
          : `<span class="pin__sil">${categoryIconSvg(pin.category, selected ? 30 : 22)}</span>`;
      const check = pin.found ? `<span class="pin__check">${CHECK_SVG}</span>` : '';
      const html = `<span class="pin pin--${pin.category}${selected ? ' is-selected' : ''}${pin.found ? ' is-found' : ''}"><span class="pin__bubble">${face}${check}</span><span class="pin__label">${esc(pin.label)}</span></span>`;
      L.marker([pin.lat, pin.lng], {
        icon: htmlIcon(html),
        title: pin.found ? `${pin.label} (찾음)` : pin.label,
        keyboard: true,
        zIndexOffset: selected ? 1000 : 0,
      })
        .on('click', () => latest.current.onSpeciesClick?.(pin.id))
        .addTo(g);
    }
  }, [speciesPins, selectedId]);

  const { me, meLabel } = props;
  useEffect(() => {
    const g = groups.current?.me;
    if (!g) return;
    g.clearLayers();
    if (!me) return;
    L.circle([me.lat, me.lng], { radius: me.accuracy, color: '#2f7fd8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(g);
    const label = meLabel ? `<span class="me-label">${esc(meLabel)}</span>` : '';
    L.marker([me.lat, me.lng], { icon: htmlIcon(`<span class="me-dot" aria-hidden="true"></span>${label}`), interactive: false, keyboard: false, zIndexOffset: 1100 }).addTo(g);
  }, [me, meLabel]);

  const { subject, radiusM } = props;
  useEffect(() => {
    const g = groups.current?.subject;
    if (!g) return;
    g.clearLayers();
    if (!subject) return;
    L.circle([subject.lat, subject.lng], { radius: radiusM ?? 25, color: '#e8692f', weight: 2, dashArray: '6 4', fillColor: '#e8692f', fillOpacity: 0.12, interactive: false }).addTo(g);
    L.marker([subject.lat, subject.lng], { icon: htmlIcon('<span class="map-target" aria-hidden="true"></span>'), interactive: false, keyboard: false }).addTo(g);
  }, [subject, radiusM]);

  const { route, routeLabel, bottomInset = 0 } = props;
  useEffect(() => {
    const g = groups.current?.route;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    if (!route) return;
    const from: L.LatLngTuple = [route.from.lat, route.from.lng];
    const to: L.LatLngTuple = [route.to.lat, route.to.lng];
    L.polyline([from, to], { color: '#2e7d4f', weight: 5, dashArray: '0.1 11', lineCap: 'round', interactive: false }).addTo(g);
    // 화살표는 화면 좌표의 방향으로 돌립니다(메르카토르라 확대해도 각도가 같음).
    const a = map.project(from, 0);
    const b = map.project(to, 0);
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    L.marker(to, { icon: htmlIcon(`<span class="route-arrow" style="transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg) translateX(-26px)"></span>`), interactive: false, keyboard: false }).addTo(g);
    if (routeLabel) {
      // 내 위치 점에 붙이되, 도착 핀과 반대쪽(위·아래)에 두어 가까워도 핀을 가리지 않게 합니다.
      const side = b.y < a.y ? 'below' : 'above';
      L.marker(from, { icon: htmlIcon(`<span class="route-label route-label--${side}">${WALK_SVG}${esc(routeLabel)}</span>`), interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(g);
    }
    map.flyToBounds(L.latLngBounds(from, to), {
      paddingTopLeft: [56, 80],
      paddingBottomRight: [56, 60 + bottomInset],
      maxZoom: fitZoom.current + 2,
      duration: 0.6,
    });
  }, [route, routeLabel, bottomInset]);

  const { flyTo, topInset = 0 } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    const wanted = fitZoom.current + Math.log2(flyTo.scale ?? 2);
    const zoom = flyTo.exact ? wanted : Math.max(map.getZoom(), wanted);
    // 머리글과 시트 사이(보이는 영역) 한가운데로 옮깁니다.
    const target = map.project([flyTo.to.lat, flyTo.to.lng], zoom).add([0, (bottomInset - topInset) / 2]);
    map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.5 });
  }, [flyTo?.key]);

  return <div ref={el} className={`park-map ${props.className ?? ''}`} role="application" aria-label="동탄호수공원 지도" />;
}

const W_H_RATIO = 1080 / 1302;

const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';
const WALK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 5.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM10 21l2.5-6.5 3 2.5v4M12.5 14.5l1-5.5m0 0-3.5 1.5-1.5 3.5m5-5 2 3.5 3 1"/></svg>';
