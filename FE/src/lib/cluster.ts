/** 화면(픽셀) 좌표로 가까운 핀을 묶습니다. 우선순위가 높은 핀이 묶음의 대표(사진)가 됩니다. */
export interface ClusterInput<T> {
  x: number;
  y: number;
  /** 클수록 먼저(대표가 됨) */
  priority: number;
  item: T;
}

export interface Cluster<T> {
  x: number;
  y: number;
  items: T[];
}

export function clusterByPixels<T>(points: ClusterInput<T>[], radiusPx: number): Cluster<T>[] {
  const sorted = [...points].sort((a, b) => b.priority - a.priority);
  const clusters: (Cluster<T> & { n: number; sx: number; sy: number })[] = [];
  const r2 = radiusPx * radiusPx;
  for (const p of sorted) {
    let hit: (typeof clusters)[number] | undefined;
    let best = Infinity;
    for (const c of clusters) {
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d <= r2 && d < best) {
        best = d;
        hit = c;
      }
    }
    if (hit) {
      hit.items.push(p.item);
      hit.n++;
      hit.sx += p.x;
      hit.sy += p.y;
    } else {
      clusters.push({ x: p.x, y: p.y, items: [p.item], n: 1, sx: p.x, sy: p.y });
    }
  }
  // 묶음 위치는 대표 핀 자리(실제 관찰 지점)에 둡니다. 평균 자리에 두면 길 밖으로 떨어질 수 있습니다.
  return clusters.map(({ x, y, items }) => ({ x, y, items }));
}
