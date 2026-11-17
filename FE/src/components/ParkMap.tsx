import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';
import type { Bounds, Category, Facility, Zone } from '../content/types';
import type { ObserverFix } from '../data/types';
import { clusterByPixels } from '../lib/cluster';
import { geometryToLatLngs, inBounds, type LatLng } from '../lib/geo';
import { isoBearing, isoProject, isoUnproject, type IsoSpec } from '../lib/iso';
import { categoryIconSvg } from './CategoryIcon';

/**
 * 지도 위에 떠 있는 생물 칸(지도 홈). 못 찾은 생물(found: false)은 빈 칸, 찾은 생물은 사진 딱지로 보입니다.
 * 가까운 것끼리는 화면에서 묶여 대표 칸 + 종 수로 보입니다.
 */
export interface PhotoPin {
  key: string;
  taxonId: string;
  lat: number;
  lng: number;
  label: string;
  category: Category;
  /** 사진 주소(생물 사진 또는 우리 가족이 찍은 사진) */
  photo: string | null;
  /** record: 공개 기록 지점 · hint: 단서 구역의 ‘찾아볼 곳’ · mine: 우리 가족 기록 */
  kind: 'record' | 'hint' | 'mine';
  found: boolean;
}

const KIND_PRIORITY: Record<PhotoPin['kind'], number> = { mine: 3, record: 2, hint: 1 };
const CLUSTER_PX = 50;

interface Props {
  imageUrl: string;
  bounds: Bounds;
  /**
   * 쿼터뷰 블록 지도로 그립니다(imageUrl은 그 그림). 없으면 위에서 본 지도입니다.
   * 쿼터뷰에서는 그림이 화면을 늘 꽉 채우고(여백 없음), 그림 밖으로는 끌 수 없습니다.
   */
  iso?: IsoSpec | null;
  attribution?: string;
  zones?: Zone[];
  showZones?: boolean;
  /** outline: 점선 경계(위치 고르기·검토), label: 구역 이름표(지도 홈) */
  zoneMode?: 'outline' | 'label';
  /** 구역 이름표를 누르면(지도 홈) */
  onZoneClick?: (id: string) => void;
  /** 떠 있는 생물 사진(묶음). 고른 종(selectedId)의 지점은 묶지 않고 모두 따로 보입니다. */
  photoPins?: PhotoPin[];
  /** 더 확대할 수 없는데 여러 종이 한 묶음일 때 */
  onClusterPick?: (taxonIds: string[]) => void;
  selectedId?: string | null;
  onSpeciesClick?: (id: string) => void;
  facilities?: Facility[];
  /** heading: 걷는 방향(북 0°). 있으면 내 위치 점에 방향 부채꼴을 그립니다. */
  me?: (ObserverFix & { heading?: number | null }) | null;
  /** 내가 걸어온 길(끊긴 곳마다 나눈 선들) */
  track?: [number, number][][];
  /** 켜 두면 내 위치가 바뀔 때마다 지도가 따라갑니다. */
  follow?: boolean;
  /** 사용자가 지도를 직접 끌었을 때(따라가기 끄기) */
  onUserMove?: () => void;
  subject?: LatLng | null;
  radiusM?: number;
  /** 내 위치 → 생물 지점 안내선(‘이곳으로 걷기’)과 이름표(예: 도보 약 6분). path가 있으면 산책로를 따라 그립니다. */
  route?: { from: LatLng; to: LatLng; path?: LatLng[] | null } | null;
  routeLabel?: string;
  /** 내 위치 점 아래 이름표 */
  meLabel?: string;
  /** 지도를 탭하면(생물 위치 고르기, 빈 곳 누르기). 공원 범위 밖은 무시합니다. */
  onMapClick?: (p: LatLng) => void;
  /** 처음에 가운데 둘 곳과 확대 배율(가장 작은 배율의 1배~) */
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
 * 좌표 다리: 위경도 ↔ Leaflet 좌표.
 * 위에서 본 지도는 위경도를 그대로 쓰고, 쿼터뷰는 Leaflet이 그림의 px 좌표(CRS.Simple, lat = −y, lng = x)를 씁니다.
 */
interface Bridge {
  iso: boolean;
  to: (lat: number, lng: number) => L.LatLng;
  from: (ll: L.LatLng) => LatLng;
  /** 그림이 놓이는 범위 */
  image: L.LatLngBounds;
  /** 화면에서의 방향(북 0° 기준 방위 → 화면 위 0°) */
  bearing: (heading: number) => number;
}
function makeBridge(bounds: Bounds, iso: IsoSpec | null | undefined): Bridge {
  if (!iso) {
    return {
      iso: false,
      to: (lat, lng) => L.latLng(lat, lng),
      from: (ll) => ({ lat: ll.lat, lng: ll.lng }),
      image: L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]),
      bearing: (h) => h,
    };
  }
  return {
    iso: true,
    to: (lat, lng) => {
      const p = isoProject(iso, { lat, lng });
      return L.latLng(-p.y, p.x);
    },
    from: (ll) => isoUnproject(iso, ll.lng, -ll.lat),
    image: L.latLngBounds([-iso.height, 0], [0, iso.width]),
    bearing: isoBearing,
  };
}

/** 땅 위의 원(반경 m)을 점들로. 쿼터뷰에서는 눌린 타원으로 보입니다. */
function groundRing(bridge: Bridge, c: LatLng, radiusM: number, n = 40): L.LatLng[] {
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((c.lat * Math.PI) / 180);
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return bridge.to(c.lat + (radiusM * Math.cos(t)) / mLat, c.lng + (radiusM * Math.sin(t)) / mLng);
  });
}

/** 점들이 보이는 영역(위·아래 가림 제외) 안에 다 들어오게 이동합니다. */
function fitTo(map: L.Map, pts: L.LatLng[], top: number, bottom: number, side: number) {
  if (!pts.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const q = map.project(p, 0);
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  const size = map.getSize();
  const availW = Math.max(60, size.x - side * 2);
  const availH = Math.max(60, size.y - top - bottom);
  let zoom = Math.log2(Math.min(availW / Math.max(maxX - minX, 1e-9), availH / Math.max(maxY - minY, 1e-9)));
  zoom = Math.min(Math.max(Math.floor(zoom * 4) / 4, map.getMinZoom()), map.getMaxZoom());
  const s = 2 ** zoom;
  map.flyTo(map.unproject(L.point(((minX + maxX) / 2) * s, ((minY + maxY) / 2) * s + (bottom - top) / 2), zoom), zoom, { duration: 0.6 });
}

const hashDelay = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ((h % 26) / 10).toFixed(1);
};

/**
 * 그림 지도 이미지 1장을 실제 좌표에 맞춰 올립니다(타일 서버 없음).
 * - 위에서 본 지도: 공원 전체가 보이는 배율의 1~4배, 이동은 공원 범위 근처로 묶습니다.
 * - 쿼터뷰(iso): 그림이 화면을 꽉 채우는 배율이 가장 작은 배율이고, 그림 밖(여백)은 볼 수 없습니다.
 */
export function ParkMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fitZoom = useRef(0);
  const groups = useRef<Record<'zones' | 'facilities' | 'photos' | 'track' | 'me' | 'subject' | 'route', L.LayerGroup> | null>(null);
  const drawPhotos = useRef<() => void>(() => {});
  const latest = useRef(props);
  latest.current = props;

  const { imageUrl, bounds, iso, attribution, scale } = props;
  const bridge = useMemo(() => makeBridge(bounds, iso), [bounds, iso]);

  useEffect(() => {
    const img = bridge.image;
    const zoomRange = bridge.iso ? 2.25 : 2; // 가장 작은 배율의 약 4~4.8배까지
    const map = L.map(el.current!, {
      crs: bridge.iso ? L.CRS.Simple : L.CRS.EPSG3857,
      zoomControl: false,
      attributionControl: false,
      // 쿼터뷰: 그림 밖은 보이지 않게 딱 맞춥니다. 위에서 본 지도: 시트에 가린 아래쪽도 끌어올려 볼 수 있게 여유를 둡니다.
      maxBounds: bridge.iso ? img : img.pad(0.3),
      maxBoundsViscosity: 1,
      minZoom: -20,
      maxZoom: 40,
      // 쿼터뷰는 그림이 화면에 딱 맞는 배율(소수)이 가장 작은 배율이라 배율을 끊지 않습니다.
      zoomSnap: bridge.iso ? 0 : 0.25,
      zoomDelta: 0.5,
      bounceAtZoomLimits: false,
    });
    L.imageOverlay(imageUrl, img, { alt: '동탄호수공원 지도' }).addTo(map);
    if (attribution) L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution(attribution).addTo(map);
    if (scale && !bridge.iso) L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 90 }).addTo(map);

    const applyZoomLimits = () => {
      // getBoundsZoom은 지금의 최소·최대 배율로 값을 자르므로, 먼저 풀어 두고 다시 잽니다.
      map.options.minZoom = -20;
      map.options.maxZoom = 40;
      let fit: number;
      if (bridge.iso) {
        // 그림이 화면을 꽉 채우는 배율(가로·세로 중 큰 쪽에 맞춤)
        fit = map.getBoundsZoom(img, true);
      } else {
        // 화면이 공원 그림보다 가로로 넓으면 가로를 채우고(세로 스크롤), 아니면 그림 전체가 보이게 합니다.
        const size = map.getSize();
        const fitWidth = map.getBoundsZoom(L.latLngBounds([img.getCenter().lat, img.getWest()], [img.getCenter().lat, img.getEast()]), false);
        fit = size.x / size.y > W_H_RATIO ? fitWidth : map.getBoundsZoom(img);
      }
      if (!Number.isFinite(fit)) return; // 아직 크기가 0인 경우
      fitZoom.current = fit;
      // setMinZoom/setMaxZoom은 확대 애니메이션을 시작해서, 그사이 지도가 사라지면 오류가 납니다. 바로 적용합니다.
      map.options.minZoom = fit;
      map.options.maxZoom = fit + zoomRange;
      const z = map.getZoom();
      if (z < fit || z > fit + zoomRange) map.setZoom(Math.min(Math.max(z, fit), fit + zoomRange), { animate: false });
      else if (bridge.iso) map.panInsideBounds(img, { animate: false });
    };
    map.fitBounds(img, { animate: false });
    applyZoomLimits();
    const { focus, focusScale = 1, topInset = 0, bottomInset = 0 } = latest.current;
    const z0 = Math.min(fitZoom.current + Math.log2(focusScale), fitZoom.current + zoomRange);
    if (focus && inBounds(focus, bounds)) {
      // 머리글과 시트 사이(보이는 영역) 한가운데에 오게 합니다.
      const shifted = map.project(bridge.to(focus.lat, focus.lng), z0).add([0, (bottomInset - topInset) / 2]);
      map.setView(map.unproject(shifted, z0), z0, { animate: false });
    } else map.setView(img.getCenter(), fitZoom.current, { animate: false });

    groups.current = {
      zones: L.layerGroup(),
      facilities: L.layerGroup().addTo(map),
      track: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      photos: L.layerGroup().addTo(map),
      me: L.layerGroup().addTo(map),
      subject: L.layerGroup().addTo(map),
    };
    map.on('click', (e: L.LeafletMouseEvent) => {
      const p = bridge.from(e.latlng);
      if (inBounds(p, bounds)) latest.current.onMapClick?.(p);
    });
    // 이름표는 조금 확대했을 때만(전체 화면에서는 서로 겹침). 생물 이름이 먼저, 지명은 더 확대했을 때.
    const toggleLabels = () => {
      const c = map.getContainer();
      c.classList.toggle('show-pin-labels', map.getZoom() >= fitZoom.current + (bridge.iso ? 0.75 : 0.25));
      c.classList.toggle('is-zoomed', map.getZoom() >= fitZoom.current + (bridge.iso ? 1.25 : 0.9));
    };
    map.on('zoomend', toggleLabels);
    toggleLabels();
    // 사진 묶음은 배율마다 다시 계산합니다.
    map.on('zoomend', () => drawPhotos.current());
    map.on('dragstart', () => latest.current.onUserMove?.());

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
  }, [imageUrl, bounds, bridge, attribution, scale]);

  const { zones, onZoneClick, showZones = true, zoneMode = 'outline' } = props;
  useEffect(() => {
    const g = groups.current?.zones;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    for (const zone of zones ?? []) {
      if (zoneMode === 'outline') {
        L.polygon(
          geometryToLatLngs(zone.geometry).map((ring) => ring.map(([lat, lng]) => bridge.to(lat, lng))),
          { color: '#1f4d36', weight: 1.5, opacity: 0.55, dashArray: '4 6', fill: false, interactive: false },
        ).addTo(g);
      } else {
        const label = zone.mapLabel ?? zone.name;
        if (!label) continue;
        L.marker(bridge.to(zone.center[0], zone.center[1]), {
          icon: htmlIcon(`<span class="map-zone">${esc(label)}</span>`),
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
  }, [zones, onZoneClick, showZones, zoneMode, bridge]);

  const { facilities } = props;
  useEffect(() => {
    const g = groups.current?.facilities;
    if (!g) return;
    g.clearLayers();
    for (const f of facilities ?? []) {
      L.marker(bridge.to(f.lat, f.lng), { icon: htmlIcon(`<span class="map-label map-label--${f.kind ?? 'place'}">${esc(f.name)}</span>`), interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(g);
    }
  }, [facilities, bridge]);

  const { photoPins, selectedId } = props;
  useEffect(() => {
    drawPhotos.current = () => {
      const g = groups.current?.photos;
      const map = mapRef.current;
      if (!g || !map) return;
      g.clearLayers();
      const pins = latest.current.photoPins ?? [];
      const sel = latest.current.selectedId ?? null;
      const zoom = map.getZoom();
      const atMax = zoom >= map.getMaxZoom() - 0.05;
      // 못 찾은 생물은 ‘빈 칸’(분류 그림자), 찾은 생물은 사진으로 채운 ‘딱지’
      const face = (p: PhotoPin) =>
        p.found && p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async"/>` : `<span class="ph__sil">${categoryIconSvg(p.category, p.kind === 'hint' ? 20 : 26)}</span>`;
      /** 떠 있는 사진 방울: 바닥 그림자 + 둥실거리는 사진(+ 뒤에 겹친 한 장, 종 수, 찾음 표시) + 이름 */
      const bubble = (p: PhotoPin, cls: string, extra: string, label: string) =>
        `<span class="ph ph--${p.kind} ph--${p.category}${p.found ? ' is-found' : ' is-empty'}${cls}" style="--d:-${hashDelay(p.key)}s"><span class="ph__shadow"></span><span class="ph__float">${extra}<span class="ph__card">${face(p)}</span>${
          p.found ? `<span class="ph__check">${CHECK_SVG}</span>` : ''
        }</span>${label}</span>`;
      const marker = (at: L.LatLng, html: string, title: string, z: number, onClick: () => void) =>
        L.marker(at, { icon: htmlIcon(html), title, keyboard: true, zIndexOffset: z, riseOnHover: true }).on('click', onClick).addTo(g);

      // 고른 종의 지점: 묶지 않고 모두 따로, 맨 위에
      const chosen = sel ? pins.filter((p) => p.taxonId === sel) : [];
      const rest = sel ? pins.filter((p) => p.taxonId !== sel) : pins;
      const clusters = clusterByPixels(
        rest.map((p) => {
          const q = map.project(bridge.to(p.lat, p.lng), zoom);
          return { x: q.x, y: q.y, priority: KIND_PRIORITY[p.kind] * 10 + (p.found ? 0 : 1), item: p };
        }),
        CLUSTER_PX,
      );
      for (const c of clusters) {
        const top = c.items[0];
        const taxa = [...new Set(c.items.map((p) => p.taxonId))];
        const one = taxa.length === 1;
        const second = one ? null : c.items.find((p) => p.taxonId !== top.taxonId)!;
        const extra = one ? '' : `<span class="ph__peek">${face(second!)}</span><span class="ph__n">${taxa.length}</span>`;
        const label = one ? `<span class="ph__label">${esc(top.label)}</span>` : '';
        const title = one ? `${top.label}${top.kind === 'hint' ? ' 찾아볼 곳' : ''}` : `생물 ${taxa.length}종: ${[...new Set(c.items.map((p) => p.label))].join(', ')}`;
        marker(map.unproject([c.x, c.y], zoom), bubble(top, `${sel ? ' is-dim' : ''}${one ? '' : ' is-group'}`, extra, label), title, KIND_PRIORITY[top.kind] * 10, () => {
          if (one) return latest.current.onSpeciesClick?.(top.taxonId);
          if (atMax) return latest.current.onClusterPick?.(taxa);
          fitTo(
            map,
            c.items.map((p) => bridge.to(p.lat, p.lng)),
            (latest.current.topInset ?? 0) + 70,
            (latest.current.bottomInset ?? 0) + 30,
            70,
          );
        });
      }
      for (const p of chosen) {
        marker(bridge.to(p.lat, p.lng), bubble(p, ' is-selected', '', ''), p.kind === 'hint' ? `${p.label} 찾아볼 곳` : p.label, 2000, () => latest.current.onSpeciesClick?.(p.taxonId));
      }
    };
    drawPhotos.current();
  }, [photoPins, selectedId, bridge]);

  const { track } = props;
  useEffect(() => {
    const g = groups.current?.track;
    if (!g) return;
    g.clearLayers();
    for (const raw of track ?? []) {
      const line = raw.map(([lat, lng]) => bridge.to(lat, lng));
      // 색은 지도 테마가 정합니다(styles.css .track-case / .track-line).
      L.polyline(line, { className: 'track-case', color: '#ffffff', weight: 9, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
      L.polyline(line, { className: 'track-line', color: '#2f7fd8', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
    }
  }, [track, bridge]);

  const { me, meLabel } = props;
  useEffect(() => {
    const g = groups.current?.me;
    if (!g) return;
    g.clearLayers();
    if (!me) return;
    L.polygon(groundRing(bridge, me, me.accuracy), { color: '#2f7fd8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(g);
    const label = meLabel ? `<span class="me-label">${esc(meLabel)}</span>` : '';
    const cone = me.heading != null ? `<span class="me-cone" style="transform:translate(-50%,-100%) rotate(${Math.round(bridge.bearing(me.heading))}deg)"></span>` : '';
    L.marker(bridge.to(me.lat, me.lng), {
      icon: htmlIcon(`${cone}<span class="me-pulse" aria-hidden="true"></span><span class="me-dot" aria-hidden="true"></span>${label}`),
      interactive: false,
      keyboard: false,
      zIndexOffset: 3000,
    }).addTo(g);
  }, [me, meLabel, bridge]);

  const { follow } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow || !me) return;
    const { topInset: top = 0, bottomInset: bottom = 0 } = latest.current;
    const zoom = Math.max(map.getZoom(), fitZoom.current + (bridge.iso ? 1.25 : 1.5));
    const target = map.project(bridge.to(me.lat, me.lng), zoom).add([0, (bottom - top) / 2]);
    if (Math.abs(zoom - map.getZoom()) > 0.01) map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.5 });
    else map.panTo(map.unproject(target, zoom), { animate: true, duration: 0.4 });
  }, [follow, me, bridge]);

  const { subject, radiusM } = props;
  useEffect(() => {
    const g = groups.current?.subject;
    if (!g) return;
    g.clearLayers();
    if (!subject) return;
    L.polygon(groundRing(bridge, subject, radiusM ?? 25), { color: '#e8692f', weight: 2, dashArray: '6 4', fillColor: '#e8692f', fillOpacity: 0.12, interactive: false }).addTo(g);
    L.marker(bridge.to(subject.lat, subject.lng), { icon: htmlIcon('<span class="map-target" aria-hidden="true"></span>'), interactive: false, keyboard: false }).addTo(g);
  }, [subject, radiusM, bridge]);

  const { route, routeLabel, bottomInset = 0 } = props;
  useEffect(() => {
    const g = groups.current?.route;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    if (!route) return;
    const from = bridge.to(route.from.lat, route.from.lng);
    const to = bridge.to(route.to.lat, route.to.lng);
    const line = route.path?.length ? route.path.map((p) => bridge.to(p.lat, p.lng)) : [from, to];
    if (route.path?.length) L.polyline(line, { className: 'route-case', color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
    L.polyline(line, { className: 'route-line', color: '#2e7d4f', weight: 5, dashArray: route.path?.length ? undefined : '0.1 11', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
    // 화살표는 마지막 구간의 화면 방향으로 돌립니다.
    const before = line.length > 2 ? line[line.length - 3] : line[0];
    const a = map.project(before, 0);
    const b = map.project(to, 0);
    const start = map.project(from, 0);
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    L.marker(to, { icon: htmlIcon(`<span class="route-arrow" style="transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg) translateX(-26px)"></span>`), interactive: false, keyboard: false }).addTo(g);
    if (routeLabel) {
      // 내 위치 점에 붙이되, 도착 지점과 반대쪽(위·아래)에 두어 가까워도 가리지 않게 합니다.
      const side = b.y < start.y ? 'below' : 'above';
      L.marker(from, { icon: htmlIcon(`<span class="route-label route-label--${side}">${WALK_SVG}${esc(routeLabel)}</span>`), interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(g);
    }
    fitTo(map, line, 50 + (latest.current.topInset ?? 0), 50 + bottomInset, 56);
  }, [route, routeLabel, bottomInset, bridge]);

  const { flyTo, topInset = 0 } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    const wanted = Math.min(fitZoom.current + Math.log2(flyTo.scale ?? 2), map.getMaxZoom());
    const zoom = flyTo.exact ? wanted : Math.max(map.getZoom(), wanted);
    // 머리글과 시트 사이(보이는 영역) 한가운데로 옮깁니다.
    const target = map.project(bridge.to(flyTo.to.lat, flyTo.to.lng), zoom).add([0, (bottomInset - topInset) / 2]);
    map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.5 });
  }, [flyTo?.key]);

  return <div ref={el} className={`park-map${bridge.iso ? ' park-map--iso' : ''} ${props.className ?? ''}`} role="application" aria-label="동탄호수공원 지도" />;
}

const W_H_RATIO = 1080 / 1302;

const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';
const WALK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 5.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM10 21l2.5-6.5 3 2.5v4M12.5 14.5l1-5.5m0 0-3.5 1.5-1.5 3.5m5-5 2 3.5 3 1"/></svg>';
