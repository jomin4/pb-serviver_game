import { CONFIG } from './config.ts';
import { isSolid, isWalkableTile, stairsAt, tileAt } from './map/grid.ts';
import type { MapData } from './map/types.ts';
import type { FloorId, ItemState, PlayerInput, PlayerState, Vec } from './types.ts';

/** 원과 타일이 "겹침"으로 판정되는 최소 침투 깊이. 경계에 정확히 닿는 것은 겹침이 아니다. */
const TOUCH_EPS = 1e-9;
const HALF = 0.5;

/** 원(중심 c, 반지름 r)이 타일 (tx, ty)와 겹치는가. */
function circleHitsTile(c: Vec, r: number, tx: number, ty: number): boolean {
  const nx = Math.max(tx, Math.min(c.x, tx + 1));
  const ny = Math.max(ty, Math.min(c.y, ty + 1));
  return Math.hypot(c.x - nx, c.y - ny) < r - TOUCH_EPS;
}

/** 원이 겹치는 단단한 타일들 (후보는 원의 외접 사각형 안 타일). */
function solidTilesHit(map: MapData, floor: FloorId, c: Vec, r: number): { tx: number; ty: number }[] {
  const hits: { tx: number; ty: number }[] = [];
  for (let ty = Math.floor(c.y - r); ty <= Math.floor(c.y + r); ty++) {
    for (let tx = Math.floor(c.x - r); tx <= Math.floor(c.x + r); tx++) {
      if (isSolid(tileAt(map, floor, tx, ty)) && circleHitsTile(c, r, tx, ty)) hits.push({ tx, ty });
    }
  }
  return hits;
}

/**
 * 한 축으로 `d`만큼 이동한다. 이동 후 단단한 칸과 겹치면 그 칸 경계(원이 닿는 위치)까지만 이동한다.
 * 이미 겹쳐 있던 경우(벽 안에서 시작)에는 뒤로 밀지 않고 제자리에 둔다.
 */
function moveAxis(map: MapData, floor: FloorId, pos: Vec, d: number, r: number, axis: 'x' | 'y'): Vec {
  if (d === 0) return pos;
  const from = pos[axis];
  const target: Vec = axis === 'x' ? { x: from + d, y: pos.y } : { x: pos.x, y: from + d };
  const hits = solidTilesHit(map, floor, target, r);
  if (hits.length === 0) return target;
  let bound = target[axis];
  for (const h of hits) {
    const t = axis === 'x' ? h.tx : h.ty;
    bound = d > 0 ? Math.min(bound, t - r) : Math.max(bound, t + 1 + r);
  }
  const clamped = d > 0 ? Math.max(from, bound) : Math.min(from, bound);
  return axis === 'x' ? { x: clamped, y: pos.y } : { x: pos.x, y: clamped };
}

/**
 * 반지름 `radius`인 원을 `delta`만큼 움직인다. x축, y축을 따로 처리해 벽을 따라 미끄러진다.
 * `delta` 길이가 `CONFIG.movement.maxStep`을 넘으면 같은 크기의 조각으로 나눠 차례로 적용한다(벽 뚫림 방지).
 * 플레이어·몬스터 공용이며 입력을 변경하지 않는다.
 */
export function moveCircle(map: MapData, floor: FloorId, pos: Vec, delta: Vec, radius: number): Vec {
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / CONFIG.movement.maxStep));
  const sx = delta.x / steps;
  const sy = delta.y / steps;
  let cur: Vec = { x: pos.x, y: pos.y };
  for (let i = 0; i < steps; i++) {
    cur = moveAxis(map, floor, cur, sx, radius, 'x');
    cur = moveAxis(map, floor, cur, sy, radius, 'y');
  }
  return cur;
}

/** 들고 있는 물건의 총 무게(kg). `items`에 없는 id는 0으로 센다. */
function carriedWeight(p: PlayerState, items: Record<string, ItemState>): number {
  let total = 0;
  for (const id of p.inventory) total += items[id]?.weight ?? 0;
  return total;
}

/** 걷기/뛰기 속도 × (1 − min(최대 감속, 총무게 × kg당 감속)). */
export function playerSpeed(p: PlayerState, items: Record<string, ItemState>, running: boolean): number {
  const { walkSpeed, runSpeed, weightSlowPerKg, weightSlowMax } = CONFIG.player;
  const slow = Math.min(weightSlowMax, carriedWeight(p, items) * weightSlowPerKg);
  return (running ? runSpeed : walkSpeed) * (1 - slow);
}

/**
 * 계단 처리. 계단 칸에 들어섰고 `onStairs`가 false면 짝 계단 칸 중심으로 옮기고 `onStairs = true`.
 * 계단 칸 위에 머무는 동안은 `onStairs`가 유지되어 왕복하지 않고, 계단 칸을 벗어나면 false로 돌아간다.
 * 새 PlayerState를 돌려주며 입력은 변경하지 않는다(유령도 재사용).
 */
export function applyStairs(map: MapData, p: PlayerState): PlayerState {
  const partner = stairsAt(map, p.floor, p.pos);
  if (!partner) return p.onStairs ? { ...p, pos: { ...p.pos }, onStairs: false } : { ...p, pos: { ...p.pos } };
  if (p.onStairs) return { ...p, pos: { ...p.pos } };
  return {
    ...p,
    floor: partner.floor,
    pos: { x: Math.floor(partner.tile.x) + HALF, y: Math.floor(partner.tile.y) + HALF },
    onStairs: true,
  };
}

/**
 * 한 틱 동안의 플레이어 이동. 새 PlayerState를 돌려주며 입력은 변경하지 않는다.
 * - 뛰기: `input.run`이고 `move`가 영벡터가 아니며 stamina > 0일 때. dt 도중 스태미나가 0이 되어도
 *   그 dt 전체를 뛴 것으로 본다(단순화; 다음 틱부터 못 뛴다).
 * - 스태미나는 뛰면 초당 `staminaDrain` 감소, 아니면 초당 `staminaRegen` 회복하며 [0, staminaMax]로 제한한다.
 * - 이동량 = `input.move`(길이 ≤ 1, 그대로 사용) × 속도 × dt, 충돌은 `moveCircle`.
 */
export function applyPlayerMovement(
  map: MapData,
  p: PlayerState,
  input: PlayerInput,
  items: Record<string, ItemState>,
  dt: number,
): PlayerState {
  const { radius, staminaMax, staminaDrain, staminaRegen } = CONFIG.player;
  const moving = input.move.x !== 0 || input.move.y !== 0;
  const running = input.run && moving && p.stamina > 0;
  const stamina = running
    ? Math.max(0, p.stamina - staminaDrain * dt)
    : Math.min(staminaMax, p.stamina + staminaRegen * dt);
  const speed = playerSpeed(p, items, running);
  const pos = moveCircle(map, p.floor, p.pos, { x: input.move.x * speed * dt, y: input.move.y * speed * dt }, radius);
  return applyStairs(map, { ...p, pos, stamina });
}

/**
 * 원이 단단한 칸과 겹치지 않으면 `pos`를 그대로, 겹치면 BFS로 가장 가까운 이동 가능 칸의 중심을 돌려준다.
 * 시작 칸이 벽이어도 동작하도록 벽을 통과하는 4방향 BFS를 쓴다. 같은 거리의 후보 중에는 `pos`에
 * 가장 가까운(유클리드) 칸, 그래도 같으면 (y, x) 순서가 빠른 칸을 고른다.
 */
export function unstick(map: MapData, floor: FloorId, pos: Vec, radius: number): Vec {
  if (solidTilesHit(map, floor, pos, radius).length === 0) return pos;
  const { width, height } = map.floors[floor];
  const sx = Math.min(width - 1, Math.max(0, Math.floor(pos.x)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor(pos.y)));
  const dist = new Int32Array(width * height).fill(-1);
  let frontier = [sy * width + sx];
  dist[frontier[0]!] = 0;
  while (frontier.length > 0) {
    const found = frontier.filter((i) => isWalkableTile(map, floor, i % width, Math.floor(i / width)));
    if (found.length > 0) {
      let best = found[0]!;
      let bestD = Infinity;
      for (const i of found.sort((a, b) => a - b)) {
        const d = Math.hypot((i % width) + HALF - pos.x, Math.floor(i / width) + HALF - pos.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      return { x: (best % width) + HALF, y: Math.floor(best / width) + HALF };
    }
    const next: number[] = [];
    for (const i of frontier) {
      const cx = i % width;
      const cy = Math.floor(i / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[i]! + 1;
        next.push(ni);
      }
    }
    frontier = next;
  }
  return pos; // 걸을 수 있는 칸이 층에 하나도 없는 비정상 맵
}
