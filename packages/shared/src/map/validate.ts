import { CONFIG } from '../config.ts';
import type { FloorId, Vec } from '../types.ts';
import { isWalkableTile, stairsAt, tileAt } from './grid.ts';
import type { MapData, Rect } from './types.ts';

const FLOORS: readonly FloorId[] = [0, 1];
const VALID_TILE_CHARS = /^[#.PCS]*$/;
const NEIGHBORS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const tileOf = (p: Vec): Vec => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
const inRect = (r: Rect, t: Vec): boolean => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
const fmt = (t: Vec): string => `(${t.x},${t.y})`;

/** B1 트럭 구역의 모든 칸에서 시작해 계단을 건너며 닿는 칸을 floor별로 표시한다. */
function reachableFromTruck(map: MapData): [Uint8Array, Uint8Array] {
  const seen: [Uint8Array, Uint8Array] = [
    new Uint8Array(map.floors[0].width * map.floors[0].height),
    new Uint8Array(map.floors[1].width * map.floors[1].height),
  ];
  const queue: { floor: FloorId; x: number; y: number }[] = [];
  const visit = (floor: FloorId, x: number, y: number): void => {
    if (!isWalkableTile(map, floor, x, y)) return;
    const i = y * map.floors[floor].width + x;
    if (seen[floor][i]) return;
    seen[floor][i] = 1;
    queue.push({ floor, x, y });
  };
  const z = map.truckZone;
  for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) visit(0, x, y);
  for (let head = 0; head < queue.length; head++) {
    const { floor, x, y } = queue[head]!;
    for (const [dx, dy] of NEIGHBORS) visit(floor, x + dx, y + dy);
    const other = stairsAt(map, floor, { x, y });
    if (other) visit(other.floor, other.tile.x, other.tile.y);
  }
  return seen;
}

/** 맵 데이터를 검사해 오류 문구 목록을 돌려준다. 빈 배열이면 통과. */
export function validateMap(map: MapData, itemCountNeeded: number): string[] {
  const errors: string[] = [];

  // 층 격자 형식
  let gridOk = true;
  for (const f of FLOORS) {
    const fl = map.floors[f];
    if (fl.rows.length !== fl.height || fl.rows.some((r) => r.length !== fl.width || !VALID_TILE_CHARS.test(r))) {
      errors.push(`floor ${f}: rows do not match ${fl.width}x${fl.height} or contain invalid tile characters`);
      gridOk = false;
    }
  }
  if (!gridOk) return errors;

  // 트럭 구역
  const z = map.truckZone;
  if (z.w <= 0 || z.h <= 0) errors.push('truckZone is empty');
  for (let y = z.y; y < z.y + z.h; y++) {
    for (let x = z.x; x < z.x + z.w; x++) {
      if (!isWalkableTile(map, 0, x, y)) errors.push(`truckZone tile ${fmt({ x, y })} is not walkable`);
    }
  }

  // 시작 위치
  if (map.spawns.length !== CONFIG.maxPlayers) {
    errors.push(`spawns must have exactly ${CONFIG.maxPlayers} entries (got ${map.spawns.length})`);
  }
  map.spawns.forEach((p, i) => {
    const t = tileOf(p);
    if (!inRect(z, t)) errors.push(`spawn[${i}] ${fmt(t)} is outside truckZone`);
    if (!isWalkableTile(map, 0, t.x, t.y)) errors.push(`spawn[${i}] ${fmt(t)} is not on a walkable tile`);
  });

  // 계단: 층 사이 짝, 계단 칸 위, 모든 'S' 칸이 짝을 가짐
  map.stairs.forEach((s, i) => {
    if (s.a.floor === s.b.floor) errors.push(`stairs[${i}] must connect two different floors`);
    for (const end of [s.a, s.b]) {
      if (tileAt(map, end.floor, end.tile.x, end.tile.y) !== 'stairs') {
        errors.push(`stairs[${i}] end floor ${end.floor} ${fmt(end.tile)} is not a stairs tile`);
      }
    }
  });
  for (const f of FLOORS) {
    const fl = map.floors[f];
    for (let y = 0; y < fl.height; y++) {
      for (let x = 0; x < fl.width; x++) {
        if (tileAt(map, f, x, y) !== 'stairs') continue;
        const partner = stairsAt(map, f, { x, y });
        if (!partner || partner.floor === f) errors.push(`stairs tile on floor ${f} ${fmt({ x, y })} has no partner on the other floor`);
      }
    }
  }

  // 고정 조명 위치
  for (const l of map.lights) {
    const t = tileOf(l.pos);
    if (tileAt(map, l.floor, t.x, t.y) === 'wall') errors.push(`light ${l.id} is inside a wall at floor ${l.floor} ${fmt(t)}`);
  }

  // 폐품 후보 칸
  if (map.itemSlots.length <= itemCountNeeded) {
    errors.push(`itemSlots (${map.itemSlots.length}) must be more than the item count needed (${itemCountNeeded})`);
  }

  const seen = reachableFromTruck(map);
  const reachable = (floor: FloorId, p: Vec): boolean => {
    const t = tileOf(p);
    return seen[floor][t.y * map.floors[floor].width + t.x] === 1;
  };

  map.itemSlots.forEach((s, i) => {
    const t = tileOf(s.pos);
    if (!isWalkableTile(map, s.floor, t.x, t.y)) {
      errors.push(`itemSlot[${i}] floor ${s.floor} ${fmt(t)} is not on a walkable tile`);
    } else if (!reachable(s.floor, s.pos)) {
      errors.push(`itemSlot[${i}] floor ${s.floor} ${fmt(t)} is unreachable from the truck zone`);
    }
  });

  // 순찰 경로: 층마다 최소 1개, 모든 지점이 이동 가능하고 닿을 수 있다
  for (const f of FLOORS) {
    if (!map.patrolRoutes.some((r) => r.floor === f && r.points.length > 0)) {
      errors.push(`patrolRoutes: floor ${f} has no patrol route`);
    }
  }
  map.patrolRoutes.forEach((r, i) => {
    r.points.forEach((p, j) => {
      const t = tileOf(p);
      if (!isWalkableTile(map, r.floor, t.x, t.y)) {
        errors.push(`patrolRoutes[${i}] point ${j} floor ${r.floor} ${fmt(t)} is not on a walkable tile`);
      } else if (!reachable(r.floor, p)) {
        errors.push(`patrolRoutes[${i}] point ${j} floor ${r.floor} ${fmt(t)} is unreachable from the truck zone`);
      }
    });
  });

  return errors;
}
