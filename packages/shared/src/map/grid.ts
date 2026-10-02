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
