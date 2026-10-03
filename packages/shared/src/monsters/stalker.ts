import { CONFIG } from '../config.ts';
import { dist, normalize } from '../geometry.ts';
import type { MapData } from '../map/types.ts';
import { moveCircle } from '../movement.ts';
import { findPath } from '../pathfinding.ts';
import { hasLineOfSight, inFlashlight } from '../vision.ts';
import type { PlayerState, StalkerMode, StalkerState, Vec, World } from '../types.ts';

/** 부동소수 누적 오차로 타이머 경계를 한 틱 놓치지 않게 하는 허용치. */
const EPS = 1e-9;
/** 조사 목표에 이만큼 가까워지면 도착으로 본다(타일). */
const INVESTIGATE_ARRIVE = 0.5;
/** 배회 지점에 이만큼 가까워지면 도착으로 본다(타일). */
const PATROL_ARRIVE = 0.3;
/** 목표가 마지막 경로 끝에서 이만큼 벗어나면 경로를 다시 계산한다(타일). */
const REPATH_DISTANCE = 1;

const copy = (v: Vec): Vec => ({ x: v.x, y: v.y });

/**
 * 추적형 한 마리를 `dt`초 진행한다. `s`만 변경한다(월드·맵·이벤트는 읽기만 한다).
 * `step`은 플레이어 이동과 소음 발생 뒤, 접촉·피해 처리 앞에서 호출한다.
 *
 * `timer`는 상태마다 뜻이 다른 하나뿐인 타이머다.
 * - chase: 대상을 놓친 지 흐른 시간(올라간다, 대상이 다시 보이면 0). `loseSeconds`에 닿으면 수색.
 * - search, retreat: 남은 시간(내려간다). 0이 되면 각각 배회, 수색.
 * - patrol, investigate: 쓰지 않는다.
 *
 * 마지막으로 경로를 구한 목표는 `path`의 마지막 노드로 알 수 있으므로 별도 필드를 두지 않는다.
 * 상태가 바뀌면 `path`를 비워 다음 이동 때 다시 계산하게 한다.
 */
export function updateStalker(world: World, map: MapData, s: StalkerState, dt: number): void {
  if (s.mode !== 'retreat') {
    const seen = detect(world, map, s);
    updateMode(world, s, seen, dt);
  } else {
    s.timer -= dt;
  }
  move(world, map, s, dt);
  if (s.mode === 'retreat' && s.timer <= EPS) {
    setMode(s, 'search');
    s.timer = CONFIG.stalker.searchSeconds;
    s.goal = copy(s.pos);
    s.targetId = null;
  }
}

/** 공격 직후 호출한다: 후퇴를 시작한다. 후퇴가 끝나면 `updateStalker`가 수색으로 넘긴다. */
export function startRetreat(s: StalkerState, fromPos: Vec): void {
  setMode(s, 'retreat');
  s.timer = CONFIG.stalker.retreatSeconds;
  s.goal = copy(fromPos);
  s.targetId = null;
}

/** 추적형에 닿은 살아 있는 플레이어 id(같은 층, 거리 < 플레이어 반경 + 추적형 반경). id 순. */
export function stalkerContacts(world: World, s: StalkerState): string[] {
  const reach = CONFIG.player.radius + CONFIG.stalker.radius;
  return Object.values(world.players)
    .filter((p) => p.alive && p.floor === s.floor && dist(p.pos, s.pos) < reach)
    .map((p) => p.id)
    .sort();
}

function setMode(s: StalkerState, mode: StalkerMode): void {
  if (s.mode !== mode) s.path = [];
  s.mode = mode;
}

/** 이 추적형이 지금 발견한 살아 있는 같은 층 플레이어. 가까운 순, 거리가 같으면 id 순. */
function detect(world: World, map: MapData, s: StalkerState): PlayerState[] {
  const found: { p: PlayerState; d: number }[] = [];
  for (const p of Object.values(world.players)) {
    if (!p.alive || p.floor !== s.floor) continue;
    const d = dist(p.pos, s.pos);
    const sighted = d <= CONFIG.stalker.sightRange && hasLineOfSight(map, s.floor, s.pos, p.pos);
    const lit = p.flashlightOn && inFlashlight(map, s.floor, p.pos, p.aim, s.pos);
    if (sighted || lit) found.push({ p, d });
  }
  found.sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
  return found.map((f) => f.p);
}

/** 이번 틱 같은 층 소음 중 반경 안에 있는 가장 가까운 소음 위치. */
function heardNoise(world: World, s: StalkerState): Vec | null {
  let best: Vec | null = null;
  let bestDist = Infinity;
  for (const e of world.events) {
    if (e.type !== 'noise' || e.floor !== s.floor) continue;
    const d = dist(e.pos, s.pos);
    if (d <= e.radius && d < bestDist) {
      best = e.pos;
      bestDist = d;
    }
  }
  return best && copy(best);
}

function startChase(s: StalkerState, target: PlayerState): void {
  setMode(s, 'chase');
  s.targetId = target.id;
  s.goal = copy(target.pos);
  s.timer = 0;
}

/** 상태 전환(후퇴 제외). 타이머도 여기서 흘린다. */
function updateMode(world: World, s: StalkerState, seen: PlayerState[], dt: number): void {
  if (s.mode === 'chase') {
    const current = seen.find((p) => p.id === s.targetId) ?? seen[0];
    if (current) {
      startChase(s, current);
      return;
    }
    s.timer += dt;
    if (s.timer >= CONFIG.stalker.loseSeconds - EPS) {
      setMode(s, 'search');
      s.timer = CONFIG.stalker.searchSeconds;
      s.goal ??= copy(s.pos);
      s.targetId = null;
    }
    return;
  }

  // 배회·조사·수색: 발견이 소리보다 우선한다.
  if (seen[0]) {
    startChase(s, seen[0]);
    return;
  }
  if (s.mode === 'patrol' || s.mode === 'search') {
    const noise = heardNoise(world, s);
    if (noise) {
      setMode(s, 'investigate');
      s.goal = noise;
      s.targetId = null;
      return;
    }
  }
  if (s.mode === 'investigate') {
    if (!s.goal || dist(s.pos, s.goal) <= INVESTIGATE_ARRIVE) {
      setMode(s, 'patrol');
      s.goal = null;
    }
  } else if (s.mode === 'search') {
    s.timer -= dt;
    if (s.timer <= EPS) {
      setMode(s, 'patrol');
      s.goal = null;
      s.timer = 0;
    }
  }
}

function modeSpeed(world: World, mode: StalkerMode): number {
  const c = CONFIG.stalker;
  const base = mode === 'chase' ? c.chaseSpeed : mode === 'investigate' ? c.investigateSpeed : c.patrolSpeed;
  const level = Math.min(CONFIG.maxPlayers, Math.max(1, world.playerCount)) as 1 | 2 | 3 | 4;
  return base * CONFIG.difficulty[level].stalkerSpeedMul * (world.round.lightsHalved ? c.lateSpeedMul : 1);
}

function move(world: World, map: MapData, s: StalkerState, dt: number): void {
  const speed = modeSpeed(world, s.mode);
  if (s.mode === 'retreat') {
    if (!s.goal) return;
    const away = normalize({ x: s.pos.x - s.goal.x, y: s.pos.y - s.goal.y });
    const dir = away.x === 0 && away.y === 0 ? { x: 1, y: 0 } : away;
    s.pos = moveCircle(map, s.floor, s.pos, { x: dir.x * speed * dt, y: dir.y * speed * dt }, CONFIG.stalker.radius);
    return;
  }

  if (s.mode === 'patrol') {
    const points = map.patrolRoutes[s.routeIndex]?.points;
    if (!points || points.length === 0) return;
    s.patrolIndex %= points.length;
    if (dist(s.pos, points[s.patrolIndex]!) <= PATROL_ARRIVE) s.patrolIndex = (s.patrolIndex + 1) % points.length;
    s.goal = copy(points[s.patrolIndex]!);
  }
  if (!s.goal) return;

  const last = s.path[s.path.length - 1];
  if ((!last || dist(last, s.goal) >= REPATH_DISTANCE) && !repath(map, s, s.goal)) {
    if (s.mode === 'investigate' || s.mode === 'search') {
      // 도달할 수 없는 목표(계단 칸, 단단한 칸 등)에 매달려 멈춰 있지 않고 배회로 돌아간다.
      setMode(s, 'patrol');
      s.goal = null;
      s.timer = 0;
      move(world, map, s, dt);
      return;
    }
    // 추격: 경로가 없어도 멈추지 않고 목표로 곧장 간다(벽은 moveCircle이 막는다). 목표 하나짜리 경로를
    // 남겨 두면 목표가 1타일 이상 움직이기 전에는 A*를 다시 돌리지 않는다. 대상이 안 보이면
    // 평소처럼 놓친 시간이 쌓여 수색으로 넘어간다.
    if (s.mode === 'chase') s.path = [copy(s.goal)];
  }
  followPath(map, s, s.goal, speed * dt);
}

/**
 * 같은 층 경로만 쓴다(추적형은 배치된 층에 머문다). 경로를 못 찾거나 계단을 타야만 닿으면
 * (목표가 계단·단단한 칸이거나 끊긴 구역) false를 돌려준다. 그때 `path`는 계단 직전까지 자른 앞부분이다.
 */
function repath(map: MapData, s: StalkerState, goal: Vec): boolean {
  const path = findPath(map, { floor: s.floor, pos: s.pos }, { floor: s.floor, pos: goal });
  const nodes: Vec[] = [];
  let reachable = path !== null;
  for (const n of path ?? []) {
    if (n.floor !== s.floor) {
      reachable = false; // 계단을 거쳐야만 닿는 목표(계단 칸 자체 포함)는 도달 불가로 본다
      break;
    }
    nodes.push(n.pos);
  }
  s.path = nodes;
  return reachable;
}

const sameTile = (a: Vec, b: Vec): boolean => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y);

/** 경로 노드를 차례로 따라 `distance`만큼 간다. 경로가 비었고 목표가 같은 칸이면 목표로 곧장 간다. */
function followPath(map: MapData, s: StalkerState, goal: Vec, distance: number): void {
  let remaining = distance;
  while (remaining > EPS) {
    const node = s.path[0];
    if (!node && !sameTile(s.pos, goal)) return;
    const target = node ?? goal;
    const d = dist(s.pos, target);
    if (d <= EPS) {
      if (!node) return;
      s.path.shift();
      continue;
    }
    const step = Math.min(d, remaining);
    const next = moveCircle(
      map,
      s.floor,
      s.pos,
      { x: ((target.x - s.pos.x) / d) * step, y: ((target.y - s.pos.y) / d) * step },
      CONFIG.stalker.radius,
    );
    const moved = dist(s.pos, next);
    s.pos = next;
    if (moved <= EPS) return;
    remaining -= step;
    if (node && step === d) s.path.shift();
  }
}
