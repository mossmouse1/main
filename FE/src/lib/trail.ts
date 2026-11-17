import { distanceM, type LatLng } from './geo';

/** 산책로 한 줄: [lat, lng][] (public/map/trails.json, scripts/build-sightings.mjs) */
export type TrailLine = [number, number][];

export interface TrailGraph {
  pts: LatLng[];
  adj: { to: number; w: number }[][];
}

const STEP_M = 15;
const JOIN_M = 12;

/**
 * 산책로 선을 15m 간격 점으로 나누고, 이웃 점끼리 잇습니다.
 * 서로 다른 길의 점이 12m 안에 있으면 갈림길로 보고 잇습니다(OSM 길이 꼭짓점을 공유하지 않는 곳이 있음).
 */
export function buildTrailGraph(lines: TrailLine[]): TrailGraph {
  const pts: LatLng[] = [];
  const lineOf: number[] = [];
  const adj: { to: number; w: number }[][] = [];
  const link = (a: number, b: number) => {
    const w = distanceM(pts[a], pts[b]);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };
  const add = (p: LatLng, line: number) => {
    pts.push(p);
    lineOf.push(line);
    adj.push([]);
    return pts.length - 1;
  };
  lines.forEach((raw, li) => {
    let prev = -1;
    for (let i = 0; i < raw.length; i++) {
      const p = { lat: raw[i][0], lng: raw[i][1] };
      if (prev >= 0) {
        const a = pts[prev];
        const n = Math.ceil(distanceM(a, p) / STEP_M);
        for (let k = 1; k < n; k++) {
          const mid = add({ lat: a.lat + ((p.lat - a.lat) * k) / n, lng: a.lng + ((p.lng - a.lng) * k) / n }, li);
          link(prev, mid);
          prev = mid;
        }
      }
      const cur = add(p, li);
      if (prev >= 0) link(prev, cur);
      prev = cur;
    }
  });
  // 갈림길: 격자(약 12m 칸)로 가까운 점만 비교합니다.
  const cell = JOIN_M / 111_000;
  const key = (p: LatLng) => `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = key(p);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  pts.forEach((p, i) => {
    const cy = Math.floor(p.lat / cell);
    const cx = Math.floor(p.lng / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (j <= i || lineOf[j] === lineOf[i]) continue;
          if (distanceM(p, pts[j]) <= JOIN_M) link(i, j);
        }
      }
    }
  });
  return { pts, adj };
}

/** 가장 가까운 산책로 점과 거리(m) */
export function snapToTrail(g: TrailGraph, p: LatLng): { node: number; point: LatLng; d: number } | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.pts.length; i++) {
    const d = distanceM(p, g.pts[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : { node: best, point: g.pts[best], d: bestD };
}

/**
 * 산책로를 따라 가는 길(다익스트라). 출발·도착점은 가장 가까운 길 점에 붙입니다.
 * 길이 이어지지 않거나 너무 돌아가면(직선의 3배 넘게) null → 부르는 쪽은 직선으로 보여 줍니다.
 */
export function routeOnTrail(g: TrailGraph, from: LatLng, to: LatLng): LatLng[] | null {
  const a = snapToTrail(g, from);
  const b = snapToTrail(g, to);
  if (!a || !b) return null;
  const n = g.pts.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  dist[a.node] = 0;
  heap.push(a.node, 0);
  while (heap.size) {
    const [u, du] = heap.pop();
    if (du > dist[u]) continue;
    if (u === b.node) break;
    for (const { to: v, w } of g.adj[u]) {
      const nd = du + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }
  if (!Number.isFinite(dist[b.node])) return null;
  const nodes: LatLng[] = [];
  for (let u = b.node; u >= 0; u = prev[u]) nodes.push(g.pts[u]);
  nodes.reverse();
  const path = [from, ...nodes, to];
  if (pathLength(path) > distanceM(from, to) * 3 + 60) return null;
  return path;
}

export function pathLength(path: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += distanceM(path[i - 1], path[i]);
  return m;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.ids[0], this.keys[0]];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
