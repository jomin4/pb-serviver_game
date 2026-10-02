import { CONFIG } from './config.ts';
import { dist } from './geometry.ts';
import { isWalkableTile, stairsAt } from './map/grid.ts';
import type { MapData } from './map/types.ts';
import type { FloorId, Vec } from './types.ts';

export type PathNode = { floor: FloorId; pos: Vec };

const HALF = 0.5;
const DIAGONAL_COST = Math.SQRT2;
const STRAIGHT_COST = 1;

/** 8방향. dx·dy가 모두 0이 아니면 대각선이다. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** 같은 층 옥타일 거리(타일 단위). */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return (DIAGONAL_COST - STRAIGHT_COST) * Math.min(dx, dy) + STRAIGHT_COST * Math.max(dx, dy);
}

/** 이진 최소 힙. 우선순위가 같으면 먼저 넣은 쪽이 먼저 나와 결과가 결정적이다. */
class MinHeap {
  private readonly nodes: number[] = [];
  private readonly prios: number[] = [];
  private readonly orders: number[] = [];
  private counter = 0;

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, prio: number): void {
    this.nodes.push(node);
    this.prios.push(prio);
    this.orders.push(this.counter++);
    this.up(this.nodes.length - 1);
  }

  pop(): number {
    const top = this.nodes[0]!;
    const last = this.nodes.length - 1;
    this.swap(0, last);
    this.nodes.pop();
    this.prios.pop();
    this.orders.pop();
    if (last > 0) this.down(0);
    return top;
  }

  private less(i: number, j: number): boolean {
    const d = this.prios[i]! - this.prios[j]!;
    return d !== 0 ? d < 0 : this.orders[i]! < this.orders[j]!;
  }

  private swap(i: number, j: number): void {
    const { nodes, prios, orders } = this;
    [nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!];
    [prios[i], prios[j]] = [prios[j]!, prios[i]!];
    [orders[i], orders[j]] = [orders[j]!, orders[i]!];
  }

  private up(start: number): void {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private down(start: number): void {
    const n = this.nodes.length;
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}

/**
 * 층을 넘나드는 A* 길찾기. 타일 중심 좌표 목록을 돌려준다(출발 칸 제외, 도착 칸 포함).
 * 4방향 + 대각선(대각선은 양옆 칸이 모두 걸을 수 있을 때만). 계단 칸에 들어서면 짝 계단 칸으로
 * 순간 이동하며(비용 `CONFIG.pathfinding.stairsCost`) 경로에는 도착 층의 계단 칸 노드가 들어간다.
 * 출발·도착 위치는 타일 안 어느 점이든 되며 내림해 타일로 쓴다. 갈 수 없으면 null.
 */
export function findPath(map: MapData, from: PathNode, to: PathNode): PathNode[] | null {
  const startTx = Math.floor(from.pos.x);
  const startTy = Math.floor(from.pos.y);
  const goalTx = Math.floor(to.pos.x);
  const goalTy = Math.floor(to.pos.y);
  if (!isWalkableTile(map, from.floor, startTx, startTy)) return null;
  if (!isWalkableTile(map, to.floor, goalTx, goalTy)) return null;

  const widths = [map.floors[0].width, map.floors[1].width] as const;
  const offsets = [0, map.floors[0].width * map.floors[0].height] as const;
  const total = offsets[1] + map.floors[1].width * map.floors[1].height;
  const indexOf = (floor: FloorId, tx: number, ty: number): number => offsets[floor] + ty * widths[floor] + tx;
  const floorOf = (idx: number): FloorId => (idx >= offsets[1] ? 1 : 0);
  const tileOfIndex = (idx: number): Vec => {
    const f = floorOf(idx);
    const local = idx - offsets[f];
    const tx = local % widths[f];
    return { x: tx, y: (local - tx) / widths[f] };
  };

  // 다른 층 휴리스틱에 쓰는 "이 층 → 도착 층" 계단 통로(양방향으로 펼친다).
  const linksByFloor = (floor: FloorId, target: FloorId) =>
    map.stairs.flatMap((s) => {
      const out: { entry: Vec; exit: Vec }[] = [];
      if (s.a.floor === floor && s.b.floor === target) out.push({ entry: s.a.tile, exit: s.b.tile });
      if (s.b.floor === floor && s.a.floor === target) out.push({ entry: s.b.tile, exit: s.a.tile });
      return out;
    });
  const crossLinks: readonly { entry: Vec; exit: Vec }[][] = [
    linksByFloor(0, to.floor),
    linksByFloor(1, to.floor),
  ];
  // 다른 층이면 계단이 없을 때 도달할 수 없다.
  if (from.floor !== to.floor && crossLinks[from.floor]!.length === 0) return null;

  // 계단 칸 진입은 마지막 한 걸음까지 합쳐 stairsCost 하나로 친다. 그 칸까지의 옥타일 거리에서
  // 마지막 한 걸음(최대 대각선 한 칸)을 뺀 값이 이웃 칸까지의 하한이다.
  const heuristic = (floor: FloorId, tx: number, ty: number): number => {
    if (floor === to.floor) return octile(tx, ty, goalTx, goalTy);
    let best = Infinity;
    for (const { entry, exit } of crossLinks[floor]!) {
      const h =
        Math.max(0, octile(tx, ty, entry.x, entry.y) - DIAGONAL_COST) +
        CONFIG.pathfinding.stairsCost +
        octile(exit.x, exit.y, goalTx, goalTy);
      if (h < best) best = h;
    }
    return best;
  };

  const startIdx = indexOf(from.floor, startTx, startTy);
  const goalIdx = indexOf(to.floor, goalTx, goalTy);
  if (startIdx === goalIdx) return [];

  const g = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap();
  g[startIdx] = 0;
  open.push(startIdx, heuristic(from.floor, startTx, startTy));

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) break;
    const floor = floorOf(cur);
    const { x: cx, y: cy } = tileOfIndex(cur);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkableTile(map, floor, nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!isWalkableTile(map, floor, cx + dx, cy) || !isWalkableTile(map, floor, cx, cy + dy))) continue;
      // 계단 칸에 들어서면 짝 계단 칸으로 바로 옮겨 선다.
      const link = stairsAt(map, floor, { x: nx, y: ny });
      const destFloor = link ? link.floor : floor;
      const destX = link ? link.tile.x : nx;
      const destY = link ? link.tile.y : ny;
      const next = indexOf(destFloor, destX, destY);
      if (closed[next]) continue;
      const stepCost = link ? CONFIG.pathfinding.stairsCost : diagonal ? DIAGONAL_COST : STRAIGHT_COST;
      const cost = g[cur]! + stepCost;
      if (cost >= g[next]!) continue;
      const h = heuristic(destFloor, destX, destY);
      if (h === Infinity) continue;
      g[next] = cost;
      parent[next] = cur;
      open.push(next, cost + h);
    }
  }

  if (parent[goalIdx] === -1) return null;
  const path: PathNode[] = [];
  for (let idx = goalIdx; idx !== startIdx; idx = parent[idx]!) {
    const t = tileOfIndex(idx);
    path.push({ floor: floorOf(idx), pos: { x: t.x + HALF, y: t.y + HALF } });
  }
  return path.reverse();
}

/**
 * 경로 길이. 같은 층에서 이어지는 노드 사이는 유클리드 거리, 층이 바뀌는 곳은 계단 비용을 더한다.
 * 출발 칸은 경로에 없으므로 첫 노드까지의 거리는 들어가지 않는다.
 */
export function pathLength(path: readonly PathNode[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    total += a.floor === b.floor ? dist(a.pos, b.pos) : CONFIG.pathfinding.stairsCost;
  }
  return total;
}
