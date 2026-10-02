import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { dist } from '../src/geometry.ts';
import { getMap } from '../src/map/index.ts';
import { findPath } from '../src/pathfinding.ts';
import type { PathNode } from '../src/pathfinding.ts';
import { createRng } from '../src/rng.ts';
import type { Rng } from '../src/rng.ts';
import { createWorld, inTruckZone } from '../src/round.ts';
import { step } from '../src/step.ts';
import type { PlayerInput, Vec, World } from '../src/types.ts';
import { overlapsSolid } from './fixtures/overlap.ts';

const DT = CONFIG.tickMs / 1000;
/** 틱 수 상한: 실제 2분(R4). */
const FUZZ_TICKS = 2400;
/** 라운드 끝까지: 게임 240분 = 실제 12분 = 14400틱보다 넉넉히. */
const END_TICKS = 15000;
/** 일꾼이 길을 다시 구하는 주기(틱). 길찾기가 테스트 시간의 큰 몫이라 드물게 한다. */
const FORAGER_REPATH_TICKS = 40;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** 플레이어마다 방향·달리기·상호작용 상태를 유지하며 무작위 입력을 만든다(0~3개, 가끔 없음). */
function makeDriver(rng: Rng, playerId: string): (w: World) => PlayerInput[] {
  let heading = rng.next() * Math.PI * 2;
  let moving = true;
  let run = false;
  let interact = false;
  let seq = 0;
  return (w) => {
    const count = rng.next() < 0.1 ? 0 : rng.int(1, 3);
    const out: PlayerInput[] = [];
    for (let i = 0; i < count; i++) {
      if (rng.next() < 0.05) heading = rng.next() * Math.PI * 2;
      if (rng.next() < 0.03) moving = !moving;
      if (rng.next() < 0.03) run = !run;
      if (rng.next() < 0.1) interact = !interact;
      const p = w.players[playerId]!;
      out.push({
        seq: ++seq,
        move: moving ? { x: Math.cos(heading) * rng.next(), y: Math.sin(heading) * rng.next() } : { x: 0, y: 0 },
        run,
        aim: rng.next() * Math.PI * 2 - Math.PI,
        toggleFlashlight: rng.next() < 0.02,
        interact,
        drop: rng.next() < 0.02,
        selectSlot: rng.next() < 0.03 ? (rng.int(0, 2) as 0 | 1 | 2) : null,
        ping: rng.next() < 0.02 ? { x: rng.next() * 80 - 10, y: rng.next() * 60 - 10 } : null,
        chat: rng.next() < 0.02 ? (rng.int(0, CONFIG.comms.quickChats.length - 1) as 0 | 1 | 2 | 3 | 4 | 5) : null,
        flicker: !p.alive && rng.next() < 0.1,
      });
    }
    return out;
  };
}

/**
 * 무작위 입력만으로는 아무도 폐품을 싣지 못하므로(라운드 후반·출발 경로가 안 돌아간다), 길찾기로 폐품을 주워
 * 트럭에 싣고 목표액을 채우면 트럭 구역에 모여 출발을 누르는 "일꾼" 입력도 섞는다. 계단을 타고 B2 폐품도 줍는다
 * (`findPath`는 층 사이 경로를 준다). `depart: false`면 출발을 누르지 않고 트럭 구역에서 기다려 시계가 끝나게 둔다.
 * 월드를 읽기만 하며 난수는 유령 떠돌기와 깜빡이기에만 쓴다.
 */
function makeForager(playerId: string, rng: Rng, depart: boolean, b2First: boolean): (w: World) => PlayerInput[] {
  const map = getMap('parking-lot');
  const zone = map.truckZone;
  const zoneCenter: Vec = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  let seq = 0;
  let path: PathNode[] = [];
  let pathAge = 0;
  let pathKey = '';
  let drift = rng.next() * Math.PI * 2;
  return (w) => {
    const p = w.players[playerId]!;
    let move: Vec = { x: 0, y: 0 };
    let interact = false;
    if (!p.alive) {
      if (rng.next() < 0.05) drift = rng.next() * Math.PI * 2;
      move = { x: Math.cos(drift), y: Math.sin(drift) };
    } else {
      const inZone = inTruckZone(map, p);
      const carried = p.inventory.length;
      const goalMet = w.round.truckTotal >= w.round.target;
      let target: PathNode = { floor: 0, pos: zoneCenter };
      let pickNear = false;
      if (carried < CONFIG.player.slots && carried < 2 && !(goalMet && carried === 0)) {
        // 같은 층 폐품을 먼저, 없으면 다른 층(계단). b2First면 B2 폐품을 먼저
        let best = Infinity;
        for (const item of Object.values(w.items)) {
          if (item.loaded || item.carriedBy !== null) continue;
          const d = dist(p.pos, item.pos) + ((b2First ? item.floor === 1 : item.floor === p.floor) ? 0 : 1000);
          if (d < best) { best = d; target = { floor: item.floor, pos: item.pos }; }
        }
        pickNear = target.floor === p.floor && best < CONFIG.player.interactRange * 0.8;
      }
      const atZoneGoal = target.pos === zoneCenter;
      if (carried > 0 && inZone) interact = w.tick % 2 === 0; // 누름 엣지로 적재
      else if (pickNear) interact = w.tick % 2 === 0; // 누름 엣지로 줍기
      else if (depart && inZone && carried === 0 && goalMet) interact = true; // 출발 누름 유지
      const waiting = interact || (inZone && atZoneGoal && carried === 0);
      if (!waiting) {
        const key = `${target.floor}:${target.pos.x},${target.pos.y}`;
        if (path.length === 0 || key !== pathKey || ++pathAge > FORAGER_REPATH_TICKS) {
          path = findPath(map, { floor: p.floor, pos: p.pos }, target) ?? [];
          pathKey = key;
          pathAge = 0;
        }
        // 지난 노드는 버린다. 다른 층 노드는 계단 칸이다: 이 층에서 같은 (x, y)로 걸어 들어가면 계단이 층을 옮겨 준다.
        while (path.length > 1 && path[0]!.floor === p.floor && dist(p.pos, path[0]!.pos) < 0.4) path.shift();
        const head = path[0];
        const next = head ? head.pos : target.floor === p.floor ? target.pos : null;
        const d = next ? dist(p.pos, next) : 0;
        if (next && d > 0.05) move = { x: (next.x - p.pos.x) / d, y: (next.y - p.pos.y) / d };
      }
    }
    return [{
      seq: ++seq, move, run: false, aim: p.aim, toggleFlashlight: false, interact, drop: false, selectSlot: null,
      ping: null, chat: null, flicker: !p.alive && rng.next() < 0.1,
    }];
  };
}

/** 틱마다 확인하는 불변 조건. 어긋나면 메시지를 돌려준다. */
function violation(w: World): string | null {
  const map = getMap(w.mapId);
  for (const p of Object.values(w.players)) {
    if (p.alive) {
      if (overlapsSolid(map, p.floor, p.pos, CONFIG.player.radius)) return `player ${p.id} overlaps solid at ${JSON.stringify(p.pos)} floor ${p.floor}`;
    } else if (p.inventory.length !== 0) {
      return `dead player ${p.id} holds ${p.inventory.join(',')}`;
    }
    if (p.inventory.length > CONFIG.player.slots) return `player ${p.id} has too many items`;
    for (const itemId of p.inventory) {
      if (w.items[itemId]?.carriedBy !== p.id) return `inventory item ${itemId} of ${p.id} not carriedBy`;
    }
  }
  for (const s of w.stalkers) {
    if (overlapsSolid(map, s.floor, s.pos, CONFIG.stalker.radius)) return `stalker ${s.id} overlaps solid at ${JSON.stringify(s.pos)} floor ${s.floor}`;
  }
  if (w.watcher.active && overlapsSolid(map, w.watcher.floor, w.watcher.pos, CONFIG.watcher.radius)) {
    return `watcher overlaps solid at ${JSON.stringify(w.watcher.pos)} floor ${w.watcher.floor}`;
  }
  let loaded = 0;
  for (const item of Object.values(w.items)) {
    if (item.loaded) loaded += item.value;
    if (item.carriedBy !== null) {
      const holder = w.players[item.carriedBy];
      if (!holder || !holder.inventory.includes(item.id)) return `item ${item.id} carriedBy ${item.carriedBy} missing from inventory`;
      if (item.loaded) return `item ${item.id} both carried and loaded`;
    }
  }
  if (w.round.phase !== 'fail' && w.round.truckTotal !== loaded) return `truckTotal ${w.round.truckTotal} !== loaded ${loaded}`;
  return null;
}

type Variant = {
  foragers: 'none' | 'all' | 'odd';
  monsters: boolean;
  /** 일꾼이 목표액을 채운 뒤 출발을 누르는가. false면 시계가 끝날 때까지 기다린다. */
  depart?: boolean;
  /** 일꾼이 B2 폐품을 먼저 노린다(계단 이동을 강제). */
  b2First?: boolean;
  /** 목표액에 곱한다(도달 가능한 값으로 낮추기). */
  targetScale?: number;
};
type FuzzResult = { world: World; leftBehind: number; usedB2: boolean };

/**
 * 시드로 월드와 입력 스트림을 만들고 `maxTicks`까지(또는 라운드가 끝날 때까지) 진행하며 매 틱 불변 조건을 확인한다.
 * `monsters: false`는 추적형을 없애고 시선형 등장을 이미 끝낸 것으로 해 둬서(`watcherSpawned`) 시계 끝까지 가게 한다.
 */
function fuzz(seed: number, maxTicks: number, variant: Variant): FuzzResult {
  const rng = createRng(seed ^ 0x9e3779b9);
  const count = rng.int(1, 4);
  const ids = range(count).map(i => `p${i + 1}`);
  let w = createWorld({ mapId: 'parking-lot', seed, players: ids.map(id => ({ id, name: id })) });
  if (!variant.monsters) {
    w.stalkers = [];
    w.round.watcherSpawned = true;
  }
  if (variant.targetScale !== undefined) w.round.target = Math.max(1, Math.round(w.round.target * variant.targetScale));
  const drivers = ids.map((id, i) => {
    const forager = variant.foragers === 'all' || (variant.foragers === 'odd' && i % 2 === 1);
    return [id, forager ? makeForager(id, rng, variant.depart ?? true, variant.b2First ?? false) : makeDriver(rng, id)] as const;
  });
  let leftBehind = 0;
  let usedB2 = false;
  for (let t = 0; t < maxTicks && w.round.phase === 'playing'; t++) {
    const inputs: Record<string, PlayerInput[]> = {};
    for (const [id, drive] of drivers) inputs[id] = drive(w);
    w = step(w, inputs, DT);
    const bad = violation(w);
    if (bad) throw new Error(`seed ${seed} tick ${w.tick}: ${bad}`);
    usedB2 ||= Object.values(w.players).some(p => p.alive && p.floor === 1);
    leftBehind += w.events.filter(e => e.type === 'death' && e.cause === 'left_behind').length;
  }
  return { world: w, leftBehind, usedB2 };
}

/** 시드 번호로 입력 종류를 돌려 쓴다: 무작위만 / 무작위 + 일꾼 섞기 / 일꾼만. */
const variantFor = (seed: number): Variant => ({ foragers: (['none', 'none', 'odd', 'all'] as const)[seed % 4]!, monsters: true });

describe('fuzz', () => {
  it.each(range(100))('시드 %i: 무작위 입력으로 최대 2분, 예외 없음 + 불변 조건', (seed) => {
    const { world } = fuzz(seed, FUZZ_TICKS, variantFor(seed));
    expect(world.tick).toBeGreaterThan(0);
  });

  // 라운드 끝까지. 일꾼은 B2까지 올라가 폐품을 모으고(목표액을 낮춰 도달 가능하게) 전원이 트럭 구역에 모여 출발을 누르거나,
  // 출발을 누르지 않고 시계가 끝나게 둔다. 승리 경로(조기 출발, 성공, 적재된 트럭으로 시계 종료, left_behind)도 매 틱 불변 조건을 거친다.
  const endVariants: { seed: number; variant: Variant }[] = [
    { seed: 2000, variant: { foragers: 'all', monsters: false, targetScale: 0.3 } },
    { seed: 2001, variant: { foragers: 'all', monsters: false, targetScale: 0.3 } },
    { seed: 2002, variant: { foragers: 'all', monsters: false, targetScale: 0.3 } },
    { seed: 2003, variant: { foragers: 'all', monsters: false, targetScale: 0.3, depart: false } },
    { seed: 2004, variant: { foragers: 'odd', monsters: false, targetScale: 0.3, depart: false } },
    { seed: 2005, variant: { foragers: 'all', monsters: false, targetScale: 0.3, b2First: true } },
    { seed: 2006, variant: { foragers: 'all', monsters: true } },
    { seed: 2007, variant: { foragers: 'none', monsters: true } },
  ];
  const results: { variant: Variant; world: World; leftBehind: number; usedB2: boolean }[] = [];
  it.each(endVariants.map((v, i) => [i, v] as const))('끝까지 %i: 라운드가 끝나 phase가 결정된다', (_i, { seed, variant }) => {
    const { world, leftBehind, usedB2 } = fuzz(seed, END_TICKS, variant);
    results.push({ variant, world, leftBehind, usedB2 });
    expect(world.round.phase).not.toBe('playing');
    expect(world.tick).toBeLessThanOrEqual(END_TICKS);
  });

  it('승리 경로가 실제로 실행되었다: 조기 출발 성공, 적재된 트럭으로 시계 종료·left_behind, B2 이동', () => {
    const early = results.filter(r => r.world.round.phase === 'success' && r.world.round.clock < CONFIG.roundEndClock);
    expect(early.length).toBeGreaterThanOrEqual(1);
    const atClockEnd = results.filter(r => r.world.round.clock === CONFIG.roundEndClock && r.world.round.truckTotal > 0);
    expect(atClockEnd.length).toBeGreaterThanOrEqual(1);
    // 적재된 트럭으로 출발했는데 구역 밖에 남은 사람은 left_behind로 죽는다
    expect(results.some(r => r.leftBehind > 0 && r.world.round.truckTotal > 0)).toBe(true);
    // 계단을 타고 B2까지 간 사람이 있었다(층 이동도 불변 조건을 거친다)
    expect(results.some(r => r.usedB2)).toBe(true);
  });
});
