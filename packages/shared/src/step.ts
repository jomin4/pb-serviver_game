import { tickCooldowns, tryChat, tryPing } from './comms.ts';
import { CONFIG } from './config.ts';
import { dist } from './geometry.ts';
import { applyGhostMovement, tryFlicker } from './ghost.ts';
import { dropAll, dropSelected, loadIntoTruck, nearestPickable, pickUp } from './items.ts';
import { getMap } from './map/index.ts';
import type { MapData } from './map/index.ts';
import { applyPlayerMovement, unstick } from './movement.ts';
import { capInputs } from './input.ts';
import { emitNoise } from './noise.ts';
import { startRetreat, stalkerContacts, updateStalker } from './monsters/stalker.ts';
import { updateWatcher, watcherContacts } from './monsters/watcher.ts';
import { advanceClock, checkAllDead, inTruckZone, rechargeInTruck, resolveDeparture, updateDepartHold } from './round.ts';
import type { GameEvent, ItemState, PlayerInput, PlayerState, Vec, World } from './types.ts';

const copyVec = (v: Vec): Vec => ({ x: v.x, y: v.y });

function cloneEvent(e: GameEvent): GameEvent {
  switch (e.type) {
    case 'ping': return { ...e, pos: copyVec(e.pos) };
    case 'noise': return { ...e, pos: copyVec(e.pos) };
    case 'flicker': return { ...e, lightIds: e.lightIds.slice() };
    default: return { ...e };
  }
}

/**
 * World(순수 데이터)의 깊은 복사. 틱마다 호출되므로 JSON 왕복 대신 손으로 복사한다(약 2배 빠름).
 * 최상위 객체는 spread로 복사해서 새 스칼라 필드가 생겨도 빠지지 않는다.
 */
export function cloneWorld(world: World): World {
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(world.players)) {
    players[id] = { ...p, pos: copyVec(p.pos), inventory: p.inventory.slice(), cooldowns: { ...p.cooldowns } };
  }
  const items: Record<string, ItemState> = {};
  for (const [id, item] of Object.entries(world.items)) items[id] = { ...item, pos: copyVec(item.pos) };
  return {
    ...world,
    players,
    items,
    stalkers: world.stalkers.map((s) => ({ ...s, pos: copyVec(s.pos), goal: s.goal && copyVec(s.goal), path: s.path.map(copyVec) })),
    watcher: {
      ...world.watcher,
      pos: copyVec(world.watcher.pos),
      path: world.watcher.path.map((n) => ({ floor: n.floor, pos: copyVec(n.pos) })),
    },
    lights: world.lights.map((l) => ({ ...l, pos: copyVec(l.pos) })),
    round: { ...world.round },
    events: world.events.map(cloneEvent),
  };
}

/**
 * 이 틱에 이 플레이어가 한 일 중 틱 끝에서 필요한 요약.
 * `latestInteract`는 입력을 하나씩 적용하며 갱신되는 상호작용 레벨(틱 끝에는 마지막 입력의 값),
 * `pressed`는 틱 안의 어느 입력에서든 떼었다 누른 엣지가 있었는지(한 틱 안의 짧은 탭도 잡는다).
 */
type TickSummary = {
  latestInteract: boolean; pressed: boolean; ran: boolean;
  startFloor: PlayerState['floor']; startPos: PlayerState['pos'];
};

/** 이동 거리가 이 값 미만이면 "움직이지 않았다"로 본다(타일). */
const MOVED_EPS = 0.01;

/** 입력이 없는 틱에 쓰는 중립 입력: 서 있고, 조준·누르고 있던 상호작용은 유지, 엣지 동작 없음. */
function neutralInput(p: PlayerState): PlayerInput {
  return {
    seq: p.lastSeq, move: { x: 0, y: 0 }, run: false, aim: p.aim, toggleFlashlight: false,
    interact: p.prevInteract, drop: false, selectSlot: null, ping: null, chat: null, flicker: false,
  };
}

/**
 * seq 오름차순, 이미 처리한 seq 이하와 중복은 버리고, 마지막 maxInputsPerBatch개만 남긴다
 * (버려지는 입력의 엣지는 `capInputs`가 남는 입력에 접는다).
 */
function selectInputs(p: PlayerState, list: PlayerInput[] | undefined): PlayerInput[] {
  if (!list || list.length === 0) return [];
  const sorted = list.slice().sort((a, b) => a.seq - b.seq);
  const fresh: PlayerInput[] = [];
  let last = p.lastSeq;
  for (const input of sorted) {
    if (input.seq <= last) continue;
    fresh.push(input);
    last = input.seq;
  }
  return capInputs(fresh, CONFIG.net.maxInputsPerBatch);
}

/** 핑 좌표를 플레이어가 있는 층의 맵 경계 [0, 너비] × [0, 높이] 안으로 제한한다. */
function clampPing(map: MapData, p: PlayerState, ping: { x: number; y: number }): { x: number; y: number } {
  const { width, height } = map.floors[p.floor];
  return { x: Math.min(width, Math.max(0, ping.x)), y: Math.min(height, Math.max(0, ping.y)) };
}

/** 입력 하나를 `inputDt`초 동안 적용한다. 요약(`ran`, `pressed`, `latestInteract`)을 갱신한다. */
function applyOneInput(world: World, map: MapData, id: string, input: PlayerInput, inputDt: number, summary: TickSummary): void {
  let p = world.players[id]!;
  const living = p.alive;

  if (input.interact && !summary.latestInteract) summary.pressed = true;
  summary.latestInteract = input.interact;

  if (input.selectSlot !== null) p.selectedSlot = input.selectSlot;
  if (living && input.toggleFlashlight) {
    if (p.flashlightOn) p.flashlightOn = false;
    else if (p.battery > 0) p.flashlightOn = true;
  }
  p.aim = input.aim;

  if (living) {
    const moving = input.move.x !== 0 || input.move.y !== 0;
    if (input.run && moving && p.stamina > 0 && !p.exhausted) summary.ran = true;
    p = applyPlayerMovement(map, p, input, world.items, inputDt);
  } else {
    p = applyGhostMovement(map, p, input, inputDt);
  }
  world.players[id] = p;

  if (living && input.drop && dropSelected(world, id) !== null) {
    emitNoise(world, p.floor, p.pos, CONFIG.noise.drop);
  }
  if (input.chat !== null) tryChat(world, id, input.chat);
  if (input.ping !== null) tryPing(world, id, clampPing(map, p, input.ping));
  if (!living && input.flicker) tryFlicker(world, id);
}

/** 플레이어를 사망 처리한다(생존자만, 한 번). */
function kill(world: World, p: PlayerState, cause: 'stalker' | 'watcher'): void {
  if (!p.alive) return;
  p.alive = false;
  p.flashlightOn = false;
  dropAll(world, p.id);
  world.events.push({ type: 'death', playerId: p.id, cause });
}

/**
 * 한 틱(`dt`초, 최대 `CONFIG.net.maxDt`)을 진행해 새 월드를 돌려준다. 입력 world는 변경하지 않는다.
 * `phase !== 'playing'`이면 world를 그대로 돌려준다. 같은 world와 입력이면 결과는 항상 같다.
 * 처리 순서는 스펙 5.4 참고(입력 → 상호작용 → 배터리 → 추적형·시선형 → 피해·사망 → 출발·시계 → 끼임 해소).
 */
export function step(world: World, inputsByPlayer: Record<string, PlayerInput[]>, dtIn: number): World {
  if (world.round.phase !== 'playing') return world;
  const dt = Number.isFinite(dtIn) ? Math.max(0, Math.min(dtIn, CONFIG.net.maxDt)) : 0;
  const w = cloneWorld(world);
  const map = getMap(w.mapId);
  const ids = Object.keys(w.players).sort();

  // 1. 이벤트·시간·쿨타임
  w.events = [];
  w.time += dt;
  w.tick += 1;
  for (const id of ids) tickCooldowns(w.players[id]!, dt);

  // 2. 입력 적용
  const summaries: Record<string, TickSummary> = {};
  for (const id of ids) {
    const p0 = w.players[id]!;
    const inputs = selectInputs(p0, inputsByPlayer[id]);
    const summary: TickSummary = {
      latestInteract: p0.prevInteract, pressed: false, ran: false,
      startFloor: p0.floor, startPos: { x: p0.pos.x, y: p0.pos.y },
    };
    summaries[id] = summary;
    if (inputs.length === 0) {
      applyOneInput(w, map, id, neutralInput(p0), dt, summary);
    } else {
      const inputDt = dt / inputs.length;
      for (const input of inputs) applyOneInput(w, map, id, input, inputDt, summary);
      w.players[id]!.lastSeq = inputs[inputs.length - 1]!.seq;
    }
  }

  // 2b. 이동 소음: 틱당 플레이어당 한 번, 최종 위치에서
  for (const id of ids) {
    const p = w.players[id]!;
    const s = summaries[id]!;
    if (!p.alive) continue;
    const moved = p.floor !== s.startFloor || dist(p.pos, s.startPos) >= MOVED_EPS;
    if (s.ran) emitNoise(w, p.floor, p.pos, CONFIG.noise.run);
    else if (moved) emitNoise(w, p.floor, p.pos, CONFIG.noise.walk);
  }

  // 3. 상호작용(누름 엣지, 틱 안의 어느 입력에서든): id 순
  for (const id of ids) {
    const p = w.players[id]!;
    const s = summaries[id]!;
    if (p.alive && s.pressed) {
      if (inTruckZone(map, p) && p.inventory.length > 0) {
        loadIntoTruck(w, id);
      } else {
        const itemId = nearestPickable(w, id);
        if (itemId !== null) pickUp(w, id, itemId);
      }
    }
    p.prevInteract = s.latestInteract;
  }

  // 4. 배터리 소모와 트럭 충전
  for (const id of ids) {
    const p = w.players[id]!;
    if (!p.alive || !p.flashlightOn) continue;
    p.battery -= dt * CONFIG.flashlight.drainPerSecond;
    if (p.battery <= 0) {
      p.battery = 0;
      p.flashlightOn = false;
    }
  }
  rechargeInTruck(w);

  // 5. 몬스터
  for (const s of w.stalkers) updateStalker(w, map, s, dt);
  updateWatcher(w, map, dt);

  // 6. 피해와 사망
  for (const s of w.stalkers) {
    if (s.mode === 'retreat') continue;
    const victimId = stalkerContacts(w, s)[0];
    if (victimId === undefined) continue;
    const victim = w.players[victimId]!;
    victim.hp -= 1;
    w.events.push({ type: 'damage', playerId: victimId });
    startRetreat(s, victim.pos);
  }
  if (w.watcher.active && !w.watcher.frozen) {
    for (const id of watcherContacts(w)) kill(w, w.players[id]!, 'watcher');
  }
  for (const id of ids) {
    const p = w.players[id]!;
    if (p.alive && p.hp <= 0) kill(w, p, 'stalker');
  }

  // 7. 라운드 종료 판정: 전멸(실패)이 출발보다 우선
  const held: Record<string, boolean> = {};
  for (const id of ids) held[id] = summaries[id]!.latestInteract;
  const departNow = updateDepartHold(w, map, held, dt);
  if (!checkAllDead(w)) {
    if (departNow) {
      resolveDeparture(w);
    } else {
      advanceClock(w, dt);
      if (w.round.clock >= CONFIG.roundEndClock) resolveDeparture(w);
    }
  }

  // 8. 끼임 해소
  for (const id of ids) {
    const p = w.players[id]!;
    if (p.alive) p.pos = unstick(map, p.floor, p.pos, CONFIG.player.radius);
  }
  for (const s of w.stalkers) s.pos = unstick(map, s.floor, s.pos, CONFIG.stalker.radius);
  if (w.watcher.active) w.watcher.pos = unstick(map, w.watcher.floor, w.watcher.pos, CONFIG.watcher.radius);

  return w;
}
