import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { dist } from '../src/geometry.ts';
import { getMap } from '../src/map/index.ts';
import { findPath } from '../src/pathfinding.ts';
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
 * 트럭에 싣고 목표액을 채우면 트럭 구역에서 출발을 누르는 "일꾼" 입력도 섞는다. 월드를 읽기만 하며 난수는 쓰지 않는다.
 */
function makeForager(playerId: string, rng: Rng): (w: World) => PlayerInput[] {
  const map = getMap('parking-lot');
  const zone = map.truckZone;
  const zoneCenter: Vec = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  let seq = 0;
  let path: Vec[] = [];
  let pathAge = 0;
  let drift = rng.next() * Math.PI * 2;
  return (w) => {
    const p = w.players[playerId]!;
    let move: Vec = { x: 0, y: 0 };
    let interact = false;
    if (!p.alive || p.floor !== 0) {
      if (rng.next() < 0.05) drift = rng.next() * Math.PI * 2;
      move = { x: Math.cos(drift), y: Math.sin(drift) };
    } else {
      const inZone = inTruckZone(map, p);
      const carried = p.inventory.length;
      let target: Vec | null = null;
      let pickNear = false;
      if (carried < CONFIG.player.slots) {
        let best = Infinity;
        for (const item of Object.values(w.items)) {
          if (item.loaded || item.carriedBy !== null || item.floor !== 0) continue;
          const d = dist(p.pos, item.pos);
          if (d < best) { best = d; target = item.pos; }
        }
        pickNear = target !== null && best < CONFIG.player.interactRange * 0.8;
      }
      if (target === null || carried >= 2) target = zoneCenter;
      if (carried > 0 && inZone) interact = w.tick % 2 === 0; // 누름 엣지로 적재
      else if (pickNear) interact = w.tick % 2 === 0; // 누름 엣지로 줍기
      else if (inZone && carried === 0 && w.round.truckTotal >= w.round.target) interact = true; // 출발 누름 유지
      const waiting = interact || (inZone && target === zoneCenter && carried === 0);
      if (!waiting) {
        if (path.length === 0 || ++pathAge > FORAGER_REPATH_TICKS) {
          path = (findPath(map, { floor: 0, pos: p.pos }, { floor: 0, pos: target })?.map(n => n.pos)) ?? [];
          pathAge = 0;
        }
        while (path.length > 1 && dist(p.pos, path[0]!) < 0.4) path.shift();
        const next = path[0] ?? target;
        const d = dist(p.pos, next);
        if (d > 0.05) move = { x: (next.x - p.pos.x) / d, y: (next.y - p.pos.y) / d };
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

type Variant = { foragers: 'none' | 'all' | 'odd'; monsters: boolean };

/**
 * 시드로 월드와 입력 스트림을 만들고 `maxTicks`까지(또는 라운드가 끝날 때까지) 진행하며 매 틱 불변 조건을 확인한다.
 * `monsters: false`는 추적형을 없애고 시선형 등장을 이미 끝낸 것으로 해 둬서(`watcherSpawned`) 시계 끝까지 가게 한다.
 */
function fuzz(seed: number, maxTicks: number, variant: Variant): World {
  const rng = createRng(seed ^ 0x9e3779b9);
  const count = rng.int(1, 4);
  const ids = range(count).map(i => `p${i + 1}`);
  let w = createWorld({ mapId: 'parking-lot', seed, players: ids.map(id => ({ id, name: id })) });
  if (!variant.monsters) {
    w.stalkers = [];
    w.round.watcherSpawned = true;
  }
  const drivers = ids.map((id, i) => {
    const forager = variant.foragers === 'all' || (variant.foragers === 'odd' && i % 2 === 1);
    return [id, forager ? makeForager(id, rng) : makeDriver(rng, id)] as const;
  });
  for (let t = 0; t < maxTicks && w.round.phase === 'playing'; t++) {
    const inputs: Record<string, PlayerInput[]> = {};
    for (const [id, drive] of drivers) inputs[id] = drive(w);
    w = step(w, inputs, DT);
    const bad = violation(w);
    if (bad) throw new Error(`seed ${seed} tick ${w.tick}: ${bad}`);
  }
  return w;
}

/** 시드 번호로 입력 종류를 돌려 쓴다: 무작위만 / 무작위 + 일꾼 섞기 / 일꾼만. */
const variantFor = (seed: number): Variant => ({ foragers: (['none', 'none', 'odd', 'all'] as const)[seed % 4]!, monsters: true });

describe('fuzz', () => {
  it.each(range(100))('시드 %i: 무작위 입력으로 최대 2분, 예외 없음 + 불변 조건', (seed) => {
    const w = fuzz(seed, FUZZ_TICKS, variantFor(seed));
    expect(w.tick).toBeGreaterThan(0);
  });

  const endVariants: Variant[] = [
    { foragers: 'all', monsters: false },
    { foragers: 'odd', monsters: false },
    { foragers: 'none', monsters: false },
    { foragers: 'all', monsters: true },
    { foragers: 'none', monsters: true },
  ];
  it.each(endVariants.map((v, i) => [i, v] as const))('끝까지 %i: 라운드가 끝나 phase가 결정된다', (i, variant) => {
    const w = fuzz(1000 + i, END_TICKS, variant);
    expect(w.round.phase).not.toBe('playing');
    expect(w.tick).toBeLessThanOrEqual(END_TICKS);
  });
});
