import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { getMap } from '../src/map/index.ts';
import { bfsDistancesAllFloors, isWalkableTile, stairsAt, tileAt } from '../src/map/grid.ts';
import {
  advanceClock,
  checkAllDead,
  createWorld,
  inTruckZone,
  rechargeInTruck,
  resolveDeparture,
  spawnWatcher,
  updateDepartHold,
} from '../src/round.ts';
import type { World } from '../src/types.ts';
import { at, tinyMap } from './fixtures/maps.ts';
import { makeItem, makePlayer, makeWorld } from './fixtures/world.ts';

const map = getMap('parking-lot');
const mk = (n: number, seed = 7): World =>
  createWorld({
    mapId: 'parking-lot',
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `n${i + 1}` })),
  });

const zone = map.truckZone;
const inside = { x: zone.x + 0.5, y: zone.y + 0.5 };
const outside = { x: zone.x + zone.w + 3.5, y: zone.y + 0.5 };

describe('createWorld', () => {
  it('1인: 목표 150, 추적형 1마리는 B2', () => {
    const w = mk(1);
    expect(w.round.target).toBe(150);
    expect(w.stalkers.map(s => s.floor)).toEqual([1]);
  });
  it('2인: 목표 250, 추적형 1마리는 B2', () => {
    const w = mk(2);
    expect(w.round.target).toBe(250);
    expect(w.stalkers.map(s => s.floor)).toEqual([1]);
    expect(w.stalkers[0]!.id).toBe('stalker-1');
  });
  it('3인: 추적형 층마다 1마리', () => {
    const w = mk(3);
    expect(w.stalkers.map(s => s.floor).sort()).toEqual([0, 1]);
    expect(w.round.target).toBe(350);
    expect(w.stalkers.map(s => s.id)).toEqual(['stalker-1', 'stalker-2']);
  });
  it('4인: 목표 450, 층마다 1마리', () => {
    const w = mk(4);
    expect(w.round.target).toBe(450);
    expect(w.stalkers.map(s => s.floor).sort()).toEqual([0, 1]);
    expect(w.playerCount).toBe(4);
  });
  it('추적형은 해당 층 첫 순찰 경로의 첫 지점에서 배회 상태로 시작한다', () => {
    const w = mk(4);
    for (const s of w.stalkers) {
      const routeIndex = map.patrolRoutes.findIndex(r => r.floor === s.floor);
      expect(s).toEqual({
        id: s.id, floor: s.floor, pos: map.patrolRoutes[routeIndex]!.points[0], mode: 'patrol',
        targetId: null, goal: null, timer: 0, patrolIndex: 0, routeIndex, path: [],
      });
    }
    expect(w.stalkers[0]!.pos).not.toBe(map.patrolRoutes[w.stalkers[0]!.routeIndex]!.points[0]);
  });
  it('플레이어는 spawns[i]에서 모든 필드를 초기화하고 시작한다', () => {
    const w = mk(2);
    expect(w.players.p2).toEqual({
      id: 'p2', name: 'n2', pos: map.spawns[1], floor: 0, aim: 0, flashlightOn: false,
      battery: CONFIG.flashlight.batteryMax, hp: CONFIG.player.hp, stamina: CONFIG.player.staminaMax,
      alive: true, inventory: [], selectedSlot: 0, lastSeq: -1, interactHeld: 0, prevInteract: false,
      onStairs: false, exhausted: false, connected: true,
      cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 0,
    });
    expect(w.players.p2!.pos).not.toBe(map.spawns[1]);
  });
  it('시선형은 비활성, 조명은 맵 lights에서 켜진 채 시작, 라운드 초기값', () => {
    const w = mk(1);
    expect(w.watcher).toEqual({ id: 'watcher', floor: 0, pos: { x: 0, y: 0 }, active: false, frozen: false, moving: false, path: [], waitTimer: 0 });
    expect(w.lights).toHaveLength(map.lights.length);
    expect(w.lights.every(l => l.on && l.flickerUntil === 0)).toBe(true);
    expect(w.lights.map(l => l.id)).toEqual(map.lights.map(l => l.id));
    expect(w.round).toEqual({ clock: 0, target: 150, truckTotal: 0, phase: 'playing', watcherSpawned: false, lightsHalved: false, horned: false });
    expect(w.events).toEqual([]);
    expect(w.tick).toBe(0);
    expect(w.time).toBe(0);
    expect(w.seed).toBe(7);
  });
  it('폐품은 시드로 결정되고 rngState에 최종 상태를 저장한다', () => {
    const a = mk(2, 5);
    const b = mk(2, 5);
    const c = mk(2, 6);
    expect(a).toEqual(b);
    expect(Object.keys(a.items).length).toBeGreaterThan(0);
    expect(a.rngState).not.toBe(5);
    expect(c.items).not.toEqual(a.items);
  });
  it('플레이어 수가 1~4가 아니면 throw', () => {
    expect(() => mk(0)).toThrow();
    expect(() => mk(5)).toThrow();
  });
});

describe('advanceClock', () => {
  it('dt / 3 만큼 시계가 오른다', () => {
    const w = mk(2);
    advanceClock(w, 3);
    expect(w.round.clock).toBe(1);
  });
  it('실제 90초 후 시선형 등장', () => {
    const w = mk(2);
    advanceClock(w, 89);
    expect(w.watcher.active).toBe(false);
    expect(w.round.watcherSpawned).toBe(false);
    advanceClock(w, 1);
    expect(w.watcher.active).toBe(true);
    expect(w.round.watcherSpawned).toBe(true);
  });
  it('03:00에 켜진 조명의 절반이 꺼진다', () => {
    const w = mk(2);
    const on = w.lights.length;
    advanceClock(w, 539);
    expect(w.lights.filter(l => l.on).length).toBe(on);
    advanceClock(w, 1);
    expect(w.lights.filter(l => l.on).length).toBe(on - Math.floor(on / 2));
    expect(w.round.lightsHalved).toBe(true);
    advanceClock(w, 30);
    expect(w.lights.filter(l => l.on).length).toBe(on - Math.floor(on / 2));
  });
  it('이미 꺼진 조명은 세지 않고 켜진 것 중 절반(내림)만 끈다', () => {
    const w = mk(2);
    w.lights[0]!.on = false;
    w.lights[1]!.on = false;
    const on = w.lights.filter(l => l.on).length;
    advanceClock(w, 540);
    expect(w.lights.filter(l => l.on).length).toBe(on - Math.floor(on / 2));
  });
  it('어떤 조명이 꺼지는지는 시드로 결정되고 rngState가 갱신된다', () => {
    const a = mk(2, 11);
    const b = mk(2, 11);
    const before = a.rngState;
    advanceClock(a, 540);
    advanceClock(b, 540);
    expect(a.lights.map(l => l.on)).toEqual(b.lights.map(l => l.on));
    expect(a.rngState).not.toBe(before);
  });
  it('03:50에 경적은 한 번만', () => {
    const w = mk(2);
    advanceClock(w, 690);
    const n1 = w.events.filter(e => e.type === 'horn').length;
    w.events = [];
    advanceClock(w, 1);
    expect(n1).toBe(1);
    expect(w.events.some(e => e.type === 'horn')).toBe(false);
    expect(w.round.horned).toBe(true);
  });
  it('한 번의 dt로 여러 기준을 넘어도 각각 정확히 한 번만 발생한다', () => {
    const w = mk(2);
    advanceClock(w, 10000);
    expect(w.round.clock).toBe(CONFIG.roundEndClock);
    expect(w.events.filter(e => e.type === 'horn')).toHaveLength(1);
    expect(w.watcher.active).toBe(true);
    const onAfter = w.lights.filter(l => l.on).length;
    advanceClock(w, 10000);
    expect(w.events.filter(e => e.type === 'horn')).toHaveLength(1);
    expect(w.lights.filter(l => l.on).length).toBe(onAfter);
    expect(w.round.clock).toBe(CONFIG.roundEndClock);
  });
  it('출발 판정은 하지 않는다(phase는 playing 그대로)', () => {
    const w = mk(2);
    advanceClock(w, 10000);
    expect(w.round.phase).toBe('playing');
    expect(w.events.some(e => e.type === 'roundEnd')).toBe(false);
  });
});

describe('bfsDistancesAllFloors', () => {
  it('층을 넘어 계단으로 이어지는 다중 출발점 BFS 거리를 돌려준다', () => {
    const [d0, d1] = bfsDistancesAllFloors(tinyMap, [at(0, 2, 4)]);
    const w = tinyMap.floors[0].width;
    expect(d0[4 * w + 2]).toBe(0);
    expect(d1[1 * w + 7]).toBe(1); // 계단 반대편 칸(7,1)
    expect(d1[1 * w + 6]).toBe(2);
    expect(d0[1 * w + 1]).toBe(4); // (2,4) -> (1,1): 1 + 3
    expect(d0[0]).toBe(-1); // 벽
  });
  it('출발점이 여러 개면 가장 가까운 출발점까지의 거리', () => {
    const [d0] = bfsDistancesAllFloors(tinyMap, [at(0, 1, 1), at(0, 8, 1)]);
    const w = tinyMap.floors[0].width;
    expect(d0[1 * w + 1]).toBe(0);
    expect(d0[1 * w + 8]).toBe(0);
    expect(d0[1 * w + 5]).toBe(3);
  });
  it('이동 불가 칸의 출발점은 무시한다', () => {
    const [d0, d1] = bfsDistancesAllFloors(tinyMap, [at(0, 0, 0)]);
    expect(Array.from(d0).every(v => v === -1)).toBe(true);
    expect(Array.from(d1).every(v => v === -1)).toBe(true);
  });
});

describe('spawnWatcher', () => {
  it('시선형은 플레이어에게서 가장 먼 칸에 등장', () => {
    const w = mk(3);
    spawnWatcher(w);
    const sources = Object.values(w.players).map(p => ({ floor: p.floor, pos: p.pos }));
    const dists = bfsDistancesAllFloors(map, sources);
    const wx = Math.floor(w.watcher.pos.x);
    const wy = Math.floor(w.watcher.pos.y);
    const width = map.floors[w.watcher.floor].width;
    const chosen = dists[w.watcher.floor]![wy * width + wx]!;
    expect(chosen).toBeGreaterThan(0);
    for (const f of [0, 1] as const) {
      const { width: fw, height: fh } = map.floors[f];
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          if (!isWalkableTile(map, f, x, y)) continue;
          expect(dists[f]![y * fw + x]!).toBeLessThanOrEqual(chosen);
        }
      }
    }
    expect(w.watcher.active).toBe(true);
    expect(w.watcher.pos).toEqual({ x: wx + 0.5, y: wy + 0.5 });
  });
  it('계단 칸에는 등장하지 않고 이동 가능 칸이다', () => {
    const w = mk(1);
    spawnWatcher(w);
    const tx = Math.floor(w.watcher.pos.x);
    const ty = Math.floor(w.watcher.pos.y);
    expect(isWalkableTile(map, w.watcher.floor, tx, ty)).toBe(true);
    expect(tileAt(map, w.watcher.floor, tx, ty)).not.toBe('stairs');
    expect(stairsAt(map, w.watcher.floor, { x: tx, y: ty })).toBeNull();
  });
  it('유령(사망자)은 거리 계산에서 제외한다', () => {
    const a = mk(2);
    a.players.p2!.alive = false;
    a.players.p2!.pos = { x: 60.5, y: 20.5 };
    const b = mk(2);
    delete b.players.p2;
    spawnWatcher(a);
    spawnWatcher(b);
    expect(a.watcher.pos).toEqual(b.watcher.pos);
    expect(a.watcher.floor).toBe(b.watcher.floor);
  });
  it('동률이면 낮은 층, 그다음 y, x가 작은 칸', () => {
    // tinyMap: 두 층 모두 열린 방. 플레이어는 B1 (1,1)과 B2 (8,3)에 있다.
    const w = makeWorld({ mapId: 'tiny', players: { a: makePlayer({ id: 'a', pos: { x: 1.5, y: 1.5 }, floor: 0 }) } });
    spawnWatcher(w, tinyMap);
    const [d0, d1] = bfsDistancesAllFloors(tinyMap, [at(0, 1, 1)]);
    const max = Math.max(...d0, ...d1.filter((_, i) => tileAt(tinyMap, 1, i % 10, Math.floor(i / 10)) !== 'stairs'));
    const best: { f: number; x: number; y: number }[] = [];
    for (const f of [0, 1] as const) {
      const d = f === 0 ? d0 : d1;
      for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
        if (d[y * 10 + x] === max && tileAt(tinyMap, f, x, y) !== 'stairs') best.push({ f, x, y });
      }
    }
    const first = best[0]!;
    expect(w.watcher.floor).toBe(first.f);
    expect(w.watcher.pos).toEqual({ x: first.x + 0.5, y: first.y + 0.5 });
  });
});

describe('inTruckZone', () => {
  it('B1의 트럭 구역 안(반열린 구간)만 true', () => {
    expect(inTruckZone(map, makePlayer({ pos: inside }))).toBe(true);
    expect(inTruckZone(map, makePlayer({ pos: { x: zone.x, y: zone.y } }))).toBe(true);
    expect(inTruckZone(map, makePlayer({ pos: { x: zone.x + zone.w, y: zone.y + 1 } }))).toBe(false);
    expect(inTruckZone(map, makePlayer({ pos: { x: zone.x + 1, y: zone.y + zone.h } }))).toBe(false);
    expect(inTruckZone(map, makePlayer({ pos: outside }))).toBe(false);
  });
  it('B2에서는 같은 좌표여도 false', () => {
    expect(inTruckZone(map, makePlayer({ pos: inside, floor: 1 }))).toBe(false);
  });
});

describe('updateDepartHold', () => {
  const two = (p2pos = inside): World =>
    makeWorld({
      mapId: 'parking-lot',
      players: { a: makePlayer({ id: 'a', pos: inside }), b: makePlayer({ id: 'b', pos: p2pos }) },
    });

  it('조기 출발: 생존자 전원 트럭 구역 + 3초 누름', () => {
    const w = two();
    const held = { a: true, b: false };
    expect(updateDepartHold(w, map, held, 2.9)).toBe(false);
    expect(w.players.a!.interactHeld).toBeCloseTo(2.9);
    expect(updateDepartHold(w, map, held, 0.1)).toBe(true);
  });
  it('누르지 않는 사람의 누적은 0으로 리셋된다', () => {
    const w = two();
    updateDepartHold(w, map, { a: true, b: true }, 1);
    updateDepartHold(w, map, { a: true, b: false }, 1);
    expect(w.players.a!.interactHeld).toBe(2);
    expect(w.players.b!.interactHeld).toBe(0);
  });
  it('중간에 손을 떼면 처음부터 다시 센다', () => {
    const w = two();
    updateDepartHold(w, map, { a: true }, 2.5);
    updateDepartHold(w, map, { a: false }, 0.05);
    expect(updateDepartHold(w, map, { a: true }, 2.9)).toBe(false);
  });
  it('한 명이라도 밖에 있으면 조기 출발 불가', () => {
    const w = two(outside);
    expect(updateDepartHold(w, map, { a: true, b: true }, 5)).toBe(false);
    expect(w.players.a!.interactHeld).toBe(0);
    expect(w.players.b!.interactHeld).toBe(0);
  });
  it('밖에 있게 되면 이미 쌓인 누적도 0이 된다', () => {
    const w = two();
    updateDepartHold(w, map, { a: true }, 2);
    w.players.b!.pos = outside;
    expect(updateDepartHold(w, map, { a: true }, 2)).toBe(false);
    expect(w.players.a!.interactHeld).toBe(0);
  });
  it('B2에 있는 생존자가 있으면 불가', () => {
    const w = two();
    w.players.b!.floor = 1;
    expect(updateDepartHold(w, map, { a: true }, 5)).toBe(false);
  });
  it('죽은 플레이어(유령)는 위치와 무관하게 조건에서 제외된다', () => {
    const w = two(outside);
    w.players.b!.alive = false;
    expect(updateDepartHold(w, map, { a: true }, 3)).toBe(true);
  });
  it('생존자가 없으면 false', () => {
    const w = two();
    w.players.a!.alive = false;
    w.players.b!.alive = false;
    expect(updateDepartHold(w, map, { a: true, b: true }, 5)).toBe(false);
  });
});

describe('resolveDeparture', () => {
  const base = (): World =>
    makeWorld({
      mapId: 'parking-lot',
      players: {
        a: makePlayer({ id: 'a', pos: inside, flashlightOn: true }),
        b: makePlayer({ id: 'b', pos: outside, flashlightOn: true, inventory: ['i1'] }),
      },
      items: { i1: makeItem('i1', 5, { value: 40, carriedBy: 'b' }) },
    });

  it('04:00 출발 시 트럭 밖 생존자는 사망하고 소지품을 떨어뜨린다', () => {
    const w = base();
    resolveDeparture(w);
    expect(w.players.a!.alive).toBe(true);
    expect(w.players.b!.alive).toBe(false);
    expect(w.players.b!.flashlightOn).toBe(false);
    expect(w.players.b!.inventory).toEqual([]);
    expect(w.items.i1!.carriedBy).toBeNull();
    expect(w.items.i1!.pos).toEqual(outside);
    expect(w.events).toContainEqual({ type: 'death', playerId: 'b', cause: 'left_behind' });
    expect(w.players.a!.flashlightOn).toBe(true);
  });
  it('B2에 있는 생존자도 트럭 구역 밖이므로 사망한다', () => {
    const w = base();
    w.players.a!.floor = 1;
    resolveDeparture(w);
    expect(w.players.a!.alive).toBe(false);
  });
  it('이미 죽은 플레이어에게는 death 이벤트를 또 내지 않는다', () => {
    const w = base();
    w.players.b!.alive = false;
    resolveDeparture(w);
    expect(w.events.filter(e => e.type === 'death')).toHaveLength(0);
  });
  it('총액 ≥ 목표면 success, 아니면 fail', () => {
    const w1 = base();
    w1.round.target = 100;
    w1.round.truckTotal = 100;
    resolveDeparture(w1);
    expect(w1.round.phase).toBe('success');
    expect(w1.events).toContainEqual({ type: 'roundEnd', phase: 'success' });

    const w2 = base();
    w2.round.target = 100;
    w2.round.truckTotal = 99;
    resolveDeparture(w2);
    expect(w2.round.phase).toBe('fail');
    expect(w2.events).toContainEqual({ type: 'roundEnd', phase: 'fail' });
    expect(w2.round.truckTotal).toBe(99);
  });
  it('phase가 playing이 아니면 아무것도 하지 않는다', () => {
    const w = base();
    w.round.phase = 'fail';
    resolveDeparture(w);
    expect(w.players.b!.alive).toBe(true);
    expect(w.events).toEqual([]);
  });
});

describe('checkAllDead', () => {
  it('전원 사망이면 fail이고 트럭 총액은 0', () => {
    const w = makeWorld({ players: { a: makePlayer({ id: 'a', alive: false }), b: makePlayer({ id: 'b', alive: false }) } });
    w.round.truckTotal = 300;
    w.round.target = 100;
    expect(checkAllDead(w)).toBe(true);
    expect(w.round.phase).toBe('fail');
    expect(w.round.truckTotal).toBe(0);
    expect(w.events).toEqual([{ type: 'roundEnd', phase: 'fail' }]);
  });
  it('생존자가 있으면 아무것도 바꾸지 않는다', () => {
    const w = makeWorld({ players: { a: makePlayer({ id: 'a', alive: false }), b: makePlayer({ id: 'b' }) } });
    w.round.truckTotal = 300;
    expect(checkAllDead(w)).toBe(false);
    expect(w.round.phase).toBe('playing');
    expect(w.round.truckTotal).toBe(300);
    expect(w.events).toEqual([]);
  });
  it('이미 끝난 라운드에서는 false, 변경 없음', () => {
    const w = makeWorld({ players: { a: makePlayer({ id: 'a', alive: false }) } });
    w.round.phase = 'success';
    w.round.truckTotal = 300;
    expect(checkAllDead(w)).toBe(false);
    expect(w.round.phase).toBe('success');
    expect(w.round.truckTotal).toBe(300);
    expect(w.events).toEqual([]);
  });
});

describe('rechargeInTruck', () => {
  it('트럭 구역에서 배터리 충전', () => {
    const w = makeWorld({
      mapId: 'parking-lot',
      players: {
        a: makePlayer({ id: 'a', pos: inside, battery: 10 }),
        b: makePlayer({ id: 'b', pos: outside, battery: 10 }),
        c: makePlayer({ id: 'c', pos: inside, battery: 10, alive: false }),
        d: makePlayer({ id: 'd', pos: inside, floor: 1, battery: 10 }),
      },
    });
    rechargeInTruck(w);
    expect(w.players.a!.battery).toBe(CONFIG.flashlight.batteryMax);
    expect(w.players.b!.battery).toBe(10);
    expect(w.players.c!.battery).toBe(10);
    expect(w.players.d!.battery).toBe(10);
  });
});
