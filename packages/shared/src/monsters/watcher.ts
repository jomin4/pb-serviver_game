import { CONFIG } from '../config.ts';
import { dist } from '../geometry.ts';
import { isWalkableTile, stairsAt } from '../map/grid.ts';
import type { MapData } from '../map/types.ts';
import { moveCircle } from '../movement.ts';
import { findPath, pathLength } from '../pathfinding.ts';
import type { PathNode } from '../pathfinding.ts';
import { inFlashlight } from '../vision.ts';
import type { PlayerState, Vec, World } from '../types.ts';

/** 부동소수 누적 오차로 타이머·경계를 한 틱 놓치지 않게 하는 허용치. */
const EPS = 1e-9;
/** 가장 가까운 생존자를 다시 고르는 주기(초). 게임 시간(`world.time`)의 이 배수를 지날 때마다 한 번이다. */
const RETARGET_SECONDS = 0.5;
/** 경로 끝 노드에서 이 이상 벗어난 곳에만 생존자가 있으면 경로를 다시 구한다(타일). 타일 중심에서 모서리까지가 약 0.7이다. */
const TARGET_DRIFT = 1.5;

const copy = (v: Vec): Vec => ({ x: v.x, y: v.y });

/** 시선형이 지금 비춰지고 있는가: 같은 층 생존자 중 손전등을 켜고 부채꼴 안(벽에 안 가림)에 시선형이 있는 사람이 있다. 유령은 해당 없음. */
export function isWatcherLit(world: World, map: MapData): boolean {
  const w = world.watcher;
  if (!w.active) return false;
  return Object.values(world.players).some(
    (p) => p.alive && p.flashlightOn && p.floor === w.floor && inFlashlight(map, w.floor, p.pos, p.aim, w.pos),
  );
}

/**
 * 시선형을 `dt`초 진행한다. `world.watcher`만 변경한다. `step`은 플레이어 이동 뒤, 접촉 처리 앞에서 호출한다.
 * 소리 이벤트는 읽지 않는다.
 *
 * - 비활성이면 아무것도 하지 않는다. 비춰지면 `frozen`이고 움직이지 않는다(`path`는 그대로 둔다).
 * - 안 비춰지면 경로 길이가 가장 짧은(같으면 id가 낮은) 살아 있는 플레이어에게 5.5타일/초로 간다.
 *   경로의 다른 층 노드는 계단이다: 그 노드로 순간 이동하고 이동 거리를 쓰지 않는다.
 * - 닿을 수 있는 생존자가 없으면 `waitTimer`를 1초로 두고 그동안 가만히 있다가 다시 찾는다.
 *
 * 목표 플레이어 id는 상태에 따로 저장하지 않는다. 마지막으로 구한 경로의 끝 노드 근처에 있는
 * 생존자가 목표이고, 경로가 비었거나 끝 노드 근처에 생존자가 없거나(목표가 움직였거나 죽음)
 * 0.5초 주기가 오면 모든 생존자에 대해 경로를 다시 구해 목표를 새로 고른다.
 */
export function updateWatcher(world: World, map: MapData, dt: number): void {
  const w = world.watcher;
  if (!w.active) return;
  w.frozen = isWatcherLit(world, map);
  w.moving = false;
  if (w.frozen) return;

  if (w.waitTimer > 0) {
    w.waitTimer -= dt;
    if (w.waitTimer > EPS) return;
    w.waitTimer = 0;
  }

  let target = retargetDue(world, dt) ? null : trackedTarget(world);
  if (!target) {
    const chosen = chooseTarget(world, map);
    if (!chosen) {
      w.path = [];
      w.waitTimer = CONFIG.watcher.waitSeconds;
      return;
    }
    target = chosen.player;
    w.path = chosen.path;
  }
  w.moving = advance(world, map, target, CONFIG.watcher.speed * dt);
}

/** 시선형에 닿은 살아 있는 플레이어 id(같은 층, 거리 < 플레이어 반경 + 시선형 반경). id 순. 비활성이면 빈 배열. */
export function watcherContacts(world: World): string[] {
  const w = world.watcher;
  if (!w.active) return [];
  const reach = CONFIG.player.radius + CONFIG.watcher.radius;
  return Object.values(world.players)
    .filter((p) => p.alive && p.floor === w.floor && dist(p.pos, w.pos) < reach)
    .map((p) => p.id)
    .sort();
}

/** 이번 틱에 0.5초 경계를 지나는가. */
function retargetDue(world: World, dt: number): boolean {
  const k = (t: number): number => Math.floor((t + EPS) / RETARGET_SECONDS);
  return k(world.time) !== k(world.time - dt);
}

const byId = (a: PlayerState, b: PlayerState): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 마지막 경로 끝 노드 근처의 가장 가까운 생존자. 경로가 비었거나 아무도 없으면 null. */
function trackedTarget(world: World): PlayerState | null {
  const last = world.watcher.path[world.watcher.path.length - 1];
  if (!last) return null;
  let best: PlayerState | null = null;
  let bestDist = TARGET_DRIFT;
  for (const p of Object.values(world.players).sort(byId)) {
    if (!p.alive || p.floor !== last.floor) continue;
    const d = dist(p.pos, last.pos);
    if (d <= bestDist && (!best || d < dist(best.pos, last.pos))) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** 경로 길이가 가장 짧은 생존자와 그 경로. 같으면 id가 낮은 쪽. 아무에게도 못 가면 null. */
function chooseTarget(world: World, map: MapData): { player: PlayerState; path: PathNode[] } | null {
  let best: { player: PlayerState; path: PathNode[] } | null = null;
  let bestLength = Infinity;
  for (const p of Object.values(world.players).sort(byId)) {
    if (!p.alive) continue;
    const path = pathTo(world, map, p);
    if (!path) continue;
    const length = pathLength(path);
    if (length < bestLength) {
      best = { player: p, path };
      bestLength = length;
    }
  }
  return best;
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

/**
 * 플레이어에게 가는 경로. 플레이어가 계단 칸에 서 있으면 그 칸은 도착지로 쓰지 않는다: 계단 칸에 들어서면
 * 반대편으로 넘어가 버려서 `findPath`가 null이나 반대 층을 도는 우회로를 돌려주기 때문이다. 대신 이웃한
 * 계단이 아닌 칸 중 경로가 가장 짧은 곳까지 가고, 마지막은 `advance`가 플레이어 위치로 곧장 간다.
 */
function pathTo(world: World, map: MapData, p: PlayerState): PathNode[] | null {
  const w = world.watcher;
  const from = { floor: w.floor, pos: w.pos };
  const tx = Math.floor(p.pos.x);
  const ty = Math.floor(p.pos.y);
  if (w.floor === p.floor && Math.floor(w.pos.x) === tx && Math.floor(w.pos.y) === ty) return [];
  if (!stairsAt(map, p.floor, { x: tx, y: ty })) return findPath(map, from, { floor: p.floor, pos: p.pos });

  let best: PathNode[] | null = null;
  let bestLength = Infinity;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!isWalkableTile(map, p.floor, nx, ny) || stairsAt(map, p.floor, { x: nx, y: ny })) continue;
    const path = findPath(map, from, { floor: p.floor, pos: { x: nx + 0.5, y: ny + 0.5 } });
    if (!path) continue;
    const length = pathLength(path);
    if (length < bestLength) {
      best = path;
      bestLength = length;
    }
  }
  return best;
}

/**
 * 경로 노드를 차례로 따라 `distance`만큼 간다. 다른 층 노드는 계단이므로 거리 없이 그곳으로 옮긴다.
 * 노드를 다 쓰면 목표 플레이어가 같은 층일 때 그 위치로 곧장 간다. 이번 틱에 위치나 층이 바뀌었으면 true.
 */
function advance(world: World, map: MapData, target: PlayerState, distance: number): boolean {
  const w = world.watcher;
  let remaining = distance;
  let moved = false;
  while (remaining > EPS) {
    const node = w.path[0];
    if (node && node.floor !== w.floor) {
      w.floor = node.floor;
      w.pos = copy(node.pos);
      w.path.shift();
      moved = true;
      continue;
    }
    const goal = node ? node.pos : target.floor === w.floor ? target.pos : null;
    if (!goal) break;
    const d = dist(w.pos, goal);
    if (d <= EPS) {
      if (!node) break;
      w.path.shift();
      continue;
    }
    const step = Math.min(d, remaining);
    const next = moveCircle(
      map,
      w.floor,
      w.pos,
      { x: ((goal.x - w.pos.x) / d) * step, y: ((goal.y - w.pos.y) / d) * step },
      CONFIG.watcher.radius,
    );
    const travelled = dist(w.pos, next);
    w.pos = next;
    if (travelled <= EPS) {
      w.path = []; // 막혔다: 다음 틱에 경로를 새로 구한다
      break;
    }
    moved = true;
    remaining -= step;
    if (node && step === d) w.path.shift();
  }
  return moved;
}
