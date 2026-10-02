import type { FloorId, Vec } from '../types.ts';
import type { MapData, TileKind } from './types.ts';

const CHAR_TO_TILE: Record<string, TileKind> = {
  '#': 'wall', '.': 'floor', P: 'pillar', C: 'car', S: 'stairs',
};

/** 타일 종류. 범위 밖은 'wall'. */
export function tileAt(map: MapData, floor: FloorId, tx: number, ty: number): TileKind {
  const f = map.floors[floor];
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= f.width || ty >= f.height) return 'wall';
  const ch = f.rows[ty]?.[tx];
  return (ch !== undefined ? CHAR_TO_TILE[ch] : undefined) ?? 'wall';
}

export const isSolid = (kind: TileKind): boolean => kind === 'wall' || kind === 'pillar' || kind === 'car';

export const isWalkableTile = (map: MapData, floor: FloorId, tx: number, ty: number): boolean =>
  !isSolid(tileAt(map, floor, tx, ty));

const NEIGHBORS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * 같은 층 안에서 `from`이 속한 타일로부터의 4방향 걸음 수. 인덱스 = ty * width + tx.
 * 도달 불가 = -1. 층을 넘는 이동은 다루지 않는다.
 */
export function bfsDistances(map: MapData, floor: FloorId, from: Vec): Int32Array {
  const { width, height } = map.floors[floor];
  const dist = new Int32Array(width * height).fill(-1);
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  if (!isWalkableTile(map, floor, sx, sy)) return dist;
  const queue: number[] = [sy * width + sx];
  dist[queue[0]!] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkableTile(map, floor, nx, ny)) continue;
      const ni = ny * width + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[cur]! + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/**
 * 여러 출발점에서 동시에 시작하는 BFS. 4방향 걸음 수이며 계단 칸에서 반대편 칸으로 1걸음에 넘어간다.
 * 반환은 [B1, B2] 거리 배열(인덱스 = ty * width + tx), 도달 불가 = -1.
 * 이동 불가 칸의 출발점은 무시한다.
 */
export function bfsDistancesAllFloors(map: MapData, sources: { floor: FloorId; pos: Vec }[]): [Int32Array, Int32Array] {
  const dist: [Int32Array, Int32Array] = [
    new Int32Array(map.floors[0].width * map.floors[0].height).fill(-1),
    new Int32Array(map.floors[1].width * map.floors[1].height).fill(-1),
  ];
  const queue: { floor: FloorId; x: number; y: number }[] = [];
  for (const s of sources) {
    const x = Math.floor(s.pos.x);
    const y = Math.floor(s.pos.y);
    if (!isWalkableTile(map, s.floor, x, y)) continue;
    const i = y * map.floors[s.floor].width + x;
    if (dist[s.floor][i] !== -1) continue;
    dist[s.floor][i] = 0;
    queue.push({ floor: s.floor, x, y });
  }
  for (let head = 0; head < queue.length; head++) {
    const { floor, x, y } = queue[head]!;
    const d = dist[floor][y * map.floors[floor].width + x]!;
    const visit = (f: FloorId, nx: number, ny: number): void => {
      if (!isWalkableTile(map, f, nx, ny)) return;
      const ni = ny * map.floors[f].width + nx;
      if (dist[f][ni] !== -1) return;
      dist[f][ni] = d + 1;
      queue.push({ floor: f, x: nx, y: ny });
    };
    for (const [dx, dy] of NEIGHBORS) visit(floor, x + dx, y + dy);
    const other = stairsAt(map, floor, { x, y });
    if (other) visit(other.floor, Math.floor(other.tile.x), Math.floor(other.tile.y));
  }
  return dist;
}

/** 그 칸이 계단이면 연결된 반대편, 아니면 null. */
export function stairsAt(map: MapData, floor: FloorId, tile: Vec): { floor: FloorId; tile: Vec } | null {
  const tx = Math.floor(tile.x);
  const ty = Math.floor(tile.y);
  for (const s of map.stairs) {
    if (s.a.floor === floor && s.a.tile.x === tx && s.a.tile.y === ty) return s.b;
    if (s.b.floor === floor && s.b.tile.x === tx && s.b.tile.y === ty) return s.a;
  }
  return null;
}
