import { CONFIG } from './config.ts';
import { dropAll, spawnItems } from './items.ts';
import { bfsDistancesAllFloors, isWalkableTile, stairsAt } from './map/grid.ts';
import { getMap } from './map/index.ts';
import type { MapData } from './map/index.ts';
import { createRng, rngFromState } from './rng.ts';
import type { FloorId, PlayerState, StalkerState, World } from './types.ts';

type PlayerCount = 1 | 2 | 3 | 4;

/** 라운드 시작 월드. 플레이어 수(1~4)가 아니면 throw. 폐품 배치는 seed에서 시작한 rng로 하고 최종 상태를 rngState에 둔다. */
export function createWorld(params: { mapId: string; seed: number; players: { id: string; name: string }[] }): World {
  const { mapId, seed, players } = params;
  const count = players.length;
  if (count < 1 || count > CONFIG.maxPlayers) throw new Error(`player count must be 1..${CONFIG.maxPlayers}, got ${count}`);
  const playerCount = count as PlayerCount;
  const map = getMap(mapId);
  const difficulty = CONFIG.difficulty[playerCount];

  const rng = createRng(seed);
  const items = spawnItems(map, rng, playerCount);

  const playerStates: Record<string, PlayerState> = {};
  players.forEach((p, i) => {
    const spawn = map.spawns[i];
    if (!spawn) throw new Error(`map ${mapId} has no spawn for player index ${i}`);
    playerStates[p.id] = {
      id: p.id, name: p.name, pos: { x: spawn.x, y: spawn.y }, floor: 0, aim: 0,
      flashlightOn: false, battery: CONFIG.flashlight.batteryMax, hp: CONFIG.player.hp, stamina: CONFIG.player.staminaMax,
      alive: true, inventory: [], selectedSlot: 0, lastSeq: -1, interactHeld: 0, prevInteract: false,
      onStairs: false, exhausted: false, connected: true,
      cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 0,
    };
  });

  const stalkerFloors: FloorId[] = difficulty.stalkers === 1 ? [1] : [0, 1];
  const stalkers = stalkerFloors.map((floor, i): StalkerState => {
    const routeIndex = map.patrolRoutes.findIndex(r => r.floor === floor);
    const start = map.patrolRoutes[routeIndex]?.points[0];
    if (!start) throw new Error(`map ${mapId} has no patrol route on floor ${floor}`);
    return {
      id: `stalker-${i + 1}`, floor, pos: { x: start.x, y: start.y }, mode: 'patrol',
      targetId: null, goal: null, timer: 0, patrolIndex: 0, routeIndex, path: [],
    };
  });

  return {
    tick: 0,
    time: 0,
    seed,
    rngState: rng.state(),
    mapId,
    playerCount,
    players: playerStates,
    items,
    stalkers,
    watcher: { id: 'watcher', floor: 0, pos: { x: 0, y: 0 }, active: false, frozen: false, moving: false, path: [], waitTimer: 0 },
    lights: map.lights.map(l => ({
      id: l.id, floor: l.floor, pos: { x: l.pos.x, y: l.pos.y }, radius: l.radius,
      on: true, flickering: l.flickering, flickerUntil: 0,
    })),
    round: { clock: 0, target: difficulty.target, truckTotal: 0, phase: 'playing', watcherSpawned: false, lightsHalved: false, horned: false },
    events: [],
    inputBudget: {},
  };
}

/** 켜진 조명 중 floor(n/2)개를 world rng로 끈다(부분 Fisher-Yates). */
function halveLights(world: World): void {
  const onIdx: number[] = [];
  world.lights.forEach((l, i) => { if (l.on) onIdx.push(i); });
  const turnOff = Math.floor(onIdx.length / 2);
  const rng = rngFromState(world.rngState);
  for (let i = 0; i < turnOff; i++) {
    const j = rng.int(i, onIdx.length - 1);
    [onIdx[i], onIdx[j]] = [onIdx[j]!, onIdx[i]!];
    world.lights[onIdx[i]!]!.on = false;
  }
  world.rngState = rng.state();
}

/**
 * (world를 직접 변경) 게임 시계를 dt(실제 초)만큼 진행한다. 시계는 roundEndClock에서 멈춘다.
 * 00:30 시선형 등장, 03:00 조명 절반 소등, 03:50 경적은 각각 한 번만 일어난다. 04:00 출발 판정은 하지 않는다.
 */
export function advanceClock(world: World, dt: number): void {
  const round = world.round;
  round.clock = Math.min(CONFIG.roundEndClock, round.clock + dt / CONFIG.realSecondsPerGameMinute);
  if (!round.watcherSpawned && round.clock >= CONFIG.watcherSpawnClock) {
    round.watcherSpawned = true;
    spawnWatcher(world);
  }
  if (!round.lightsHalved && round.clock >= CONFIG.lightsHalfClock) {
    round.lightsHalved = true;
    halveLights(world);
  }
  if (!round.horned && round.clock >= CONFIG.hornClock) {
    round.horned = true;
    world.events.push({ type: 'horn' });
  }
}

/**
 * (world를 직접 변경) 시선형을 살아 있는 플레이어 전원에게서 BFS 거리(층 간 포함)가 가장 먼 이동 가능 칸(계단 제외)에 놓고 활성화한다.
 * 동률이면 낮은 층, 작은 y, 작은 x. 도달 불가 칸은 제외한다. 후보가 없으면 위치는 그대로 두고 활성화만 한다.
 */
export function spawnWatcher(world: World, map: MapData = getMap(world.mapId)): void {
  const sources = Object.values(world.players).filter(p => p.alive).map(p => ({ floor: p.floor, pos: p.pos }));
  const dists = bfsDistancesAllFloors(map, sources);
  let best: { floor: FloorId; x: number; y: number } | null = null;
  let bestDist = -1;
  for (const floor of [0, 1] as const) {
    const { width, height } = map.floors[floor];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = dists[floor][y * width + x]!;
        if (d <= bestDist) continue; // 같으면 먼저 본(낮은 층·y·x) 칸 유지
        if (!isWalkableTile(map, floor, x, y) || stairsAt(map, floor, { x, y })) continue;
        best = { floor, x, y };
        bestDist = d;
      }
    }
  }
  if (best) {
    world.watcher.floor = best.floor;
    world.watcher.pos = { x: best.x + 0.5, y: best.y + 0.5 };
  }
  world.watcher.active = true;
}

/** 플레이어가 B1 트럭 구역 [x, x+w) × [y, y+h) 안에 있는가. */
export function inTruckZone(map: MapData, p: PlayerState): boolean {
  const z = map.truckZone;
  return p.floor === 0 && p.pos.x >= z.x && p.pos.x < z.x + z.w && p.pos.y >= z.y && p.pos.y < z.y + z.h;
}

/** 누름 시간 누적의 부동소수 오차 허용치(dt 0.05 × 60 = 2.9999…도 3초로 본다). stalker·comms와 같은 관례. */
const HOLD_EPS = 1e-9;

/**
 * (world를 직접 변경) 조기 출발 누름 판정. held는 이번 틱에 상호작용을 누르고 있는 플레이어 id.
 * 살아 있는 플레이어가 1명 이상이고 전원 트럭 구역에 있을 때만 누적(누른 사람은 += dt, 뗀 사람은 0)하고,
 * 누적이 departHoldSeconds 이상(HOLD_EPS 허용)인 사람이 있으면 true. 조건이 깨지면 모두 0으로 되돌리고 false.
 */
export function updateDepartHold(world: World, map: MapData, held: Record<string, boolean>, dt: number): boolean {
  const all = Object.values(world.players);
  const living = all.filter(p => p.alive);
  if (living.length === 0 || !living.every(p => inTruckZone(map, p))) {
    for (const p of all) p.interactHeld = 0;
    return false;
  }
  let depart = false;
  for (const p of all) {
    if (!p.alive) { p.interactHeld = 0; continue; }
    p.interactHeld = held[p.id] ? p.interactHeld + dt : 0;
    if (p.interactHeld >= CONFIG.player.departHoldSeconds - HOLD_EPS) depart = true;
  }
  return depart;
}

/** (world를 직접 변경) 트럭 출발. 구역 밖 생존자는 사망(left_behind)하고 소지품을 떨어뜨린다. 그 뒤 성공/실패를 정한다. */
export function resolveDeparture(world: World): void {
  if (world.round.phase !== 'playing') return;
  const map = getMap(world.mapId);
  for (const p of Object.values(world.players)) {
    if (!p.alive || inTruckZone(map, p)) continue;
    p.alive = false;
    p.flashlightOn = false;
    dropAll(world, p.id);
    world.events.push({ type: 'death', playerId: p.id, cause: 'left_behind' });
  }
  world.round.phase = world.round.truckTotal >= world.round.target ? 'success' : 'fail';
  world.events.push({ type: 'roundEnd', phase: world.round.phase });
}

/** (world를 직접 변경) 생존자가 없으면 즉시 실패(트럭 총액 무효)시키고 true. 이미 끝난 라운드면 false. */
export function checkAllDead(world: World): boolean {
  if (world.round.phase !== 'playing') return false;
  if (Object.values(world.players).some(p => p.alive)) return false;
  world.round.phase = 'fail';
  world.round.truckTotal = 0;
  world.events.push({ type: 'roundEnd', phase: 'fail' });
  return true;
}

/** (world를 직접 변경) 트럭 구역 안의 생존자 배터리를 최대치로 충전한다. */
export function rechargeInTruck(world: World): void {
  const map = getMap(world.mapId);
  for (const p of Object.values(world.players)) {
    if (p.alive && inTruckZone(map, p)) p.battery = CONFIG.flashlight.batteryMax;
  }
}
