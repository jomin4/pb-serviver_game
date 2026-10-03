import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { tickCooldowns, tryChat, tryPing } from '../src/comms.ts';
import { applyGhostMovement, tryFlicker } from '../src/ghost.ts';
import type { LightState, PlayerState, World } from '../src/types.ts';
import { open20, tinyMap } from './fixtures/maps.ts';
import { makeInput, makePlayer, makeWorld } from './fixtures/world.ts';

const G = CONFIG.ghost;
const C = CONFIG.comms;

const mkLight = (id: string, x: number, y: number, partial: Partial<LightState> = {}): LightState => ({
  id, floor: 0, pos: { x, y }, radius: 6, on: true, flickering: false, flickerUntil: 0, ...partial,
});

/** 유령 'g'와 생존자 'a'가 있는 월드. 유령 기본 위치는 (10.5, 10.5). */
const mkWorld = (lights: LightState[] = [], ghost: Partial<PlayerState> = {}): World =>
  makeWorld({
    players: {
      g: makePlayer({ id: 'g', alive: false, pos: { x: 10.5, y: 10.5 }, ...ghost }),
      a: makePlayer({ id: 'a' }),
    },
    lights,
  });

describe('applyGhostMovement', () => {
  const ghost = (partial: Partial<PlayerState> = {}) => makePlayer({ alive: false, ...partial });

  it('유령은 벽을 통과한다', () => {
    // tinyMap B1 중간 벽 x=5 (y=2..4). 4.5에서 오른쪽으로 0.2초 → 1.2 이동.
    const p = ghost({ pos: { x: 4.5, y: 3.5 } });
    const next = applyGhostMovement(tinyMap, p, makeInput({ move: { x: 1, y: 0 } }), 0.2);
    expect(next.pos.x).toBeCloseTo(4.5 + G.speed * 0.2, 9);
    expect(next.pos.y).toBeCloseTo(3.5, 9);
    expect(next.floor).toBe(0);
  });

  it('속도는 초당 6타일이고 입력과 스태미나는 건드리지 않는다', () => {
    const p = ghost({ pos: { x: 5, y: 5 }, stamina: 3 });
    const input = makeInput({ move: { x: 0, y: -0.5 }, run: true });
    const next = applyGhostMovement(open20, p, input, 0.5);
    expect(next.pos.y).toBeCloseTo(5 - 0.5 * 6 * 0.5, 9);
    expect(next.stamina).toBe(3);
    expect(p.pos).toEqual({ x: 5, y: 5 }); // 원본 불변
    expect(next).not.toBe(p);
  });

  it('맵 경계 밖으로 나가지 않는다', () => {
    const p = ghost({ pos: { x: 1, y: 1 } });
    const next = applyGhostMovement(open20, p, makeInput({ move: { x: -1, y: -1 } }), 1);
    expect(next.pos.x).toBeGreaterThanOrEqual(0);
    expect(next.pos.y).toBeGreaterThanOrEqual(0);
    expect(next.pos.x).toBeLessThan(1e-3);
    const far = applyGhostMovement(open20, ghost({ pos: { x: 19, y: 19 } }), makeInput({ move: { x: 1, y: 1 } }), 1);
    expect(far.pos.x).toBeLessThan(20);
    expect(far.pos.y).toBeLessThan(20);
    expect(far.pos.x).toBeGreaterThan(20 - 1e-3);
  });

  it('계단 칸에서는 생존자와 같은 방식으로 층을 옮긴다', () => {
    // tinyMap: B1 계단 (2,4) ↔ B2 계단 (7,1)
    const p = ghost({ pos: { x: 2.5, y: 3.5 } });
    const next = applyGhostMovement(tinyMap, p, makeInput({ move: { x: 0, y: 1 } }), 0.2);
    expect(next.floor).toBe(1);
    expect(next.pos).toEqual({ x: 7.5, y: 1.5 });
    expect(next.onStairs).toBe(true);
    // 계단 칸 위에 머물면 왕복하지 않는다
    const stay = applyGhostMovement(tinyMap, next, makeInput({ move: { x: 0.1, y: 0 } }), 0.01);
    expect(stay.floor).toBe(1);
    // 계단 칸을 벗어나면 래치가 풀린다
    const off = applyGhostMovement(tinyMap, stay, makeInput({ move: { x: -1, y: 0 } }), 0.5);
    expect(off.onStairs).toBe(false);
  });
});

describe('tryFlicker', () => {
  it('유령은 반경 3 안의 같은 층 조명을 깜빡이게 한다', () => {
    const world = mkWorld([mkLight('l2', 12.5, 10.5), mkLight('l1', 10.5, 13.5), mkLight('far', 10.5, 13.6)]);
    world.time = 5;
    expect(tryFlicker(world, 'g')).toBe(true);
    const byId = Object.fromEntries(world.lights.map((l) => [l.id, l]));
    expect(byId.l1!.flickerUntil).toBeCloseTo(5 + G.flickerSeconds, 9); // 거리 정확히 3은 포함
    expect(byId.l2!.flickerUntil).toBeCloseTo(5 + G.flickerSeconds, 9);
    expect(byId.far!.flickerUntil).toBe(0);
    expect(world.events).toEqual([{ type: 'flicker', lightIds: ['l1', 'l2'] }]);
    expect(world.players.g!.cooldowns.flicker).toBe(G.flickerCooldown);
  });

  it('다른 층 조명과 꺼진 조명은 영향을 받지 않는다', () => {
    const world = mkWorld([mkLight('other', 10.5, 10.5, { floor: 1 }), mkLight('off', 10.5, 11.5, { on: false }), mkLight('ok', 9.5, 10.5)]);
    expect(tryFlicker(world, 'g')).toBe(true);
    expect(world.lights.map((l) => l.flickerUntil)).toEqual([0, 0, 1.5]);
    expect(world.events).toEqual([{ type: 'flicker', lightIds: ['ok'] }]);
  });

  it('생존자는 깜빡이기를 쓸 수 없다', () => {
    const world = mkWorld([mkLight('l', 1.5, 1.5)]);
    expect(tryFlicker(world, 'a')).toBe(false);
    expect(world.lights[0]!.flickerUntil).toBe(0);
    expect(world.events).toEqual([]);
    expect(world.players.a!.cooldowns.flicker).toBe(0);
  });

  it('없는 플레이어는 쓸 수 없다', () => {
    const world = mkWorld([mkLight('l', 10.5, 10.5)]);
    expect(tryFlicker(world, 'nobody')).toBe(false);
    expect(world.events).toEqual([]);
  });

  it('깜빡이기 쿨타임 10초', () => {
    const world = mkWorld([mkLight('l', 10.5, 10.5)]);
    const g = world.players.g!;
    expect(tryFlicker(world, 'g')).toBe(true);
    tickCooldowns(g, 9.9);
    expect(tryFlicker(world, 'g')).toBe(false);
    expect(world.events).toHaveLength(1);
    tickCooldowns(g, 0.1);
    expect(g.cooldowns.flicker).toBe(0);
    expect(tryFlicker(world, 'g')).toBe(true);
    expect(world.events).toHaveLength(2);
  });

  it('반경 3 안에 조명이 없으면 쿨타임을 소모하지 않는다', () => {
    const world = mkWorld([mkLight('far', 10.5, 13.6), mkLight('off', 10.5, 10.5, { on: false })]);
    expect(tryFlicker(world, 'g')).toBe(false);
    expect(world.players.g!.cooldowns.flicker).toBe(0);
    expect(world.events).toEqual([]);
    expect(world.lights.every((l) => l.flickerUntil === 0)).toBe(true);
    // 조명 근처로 옮기면 곧바로 쓸 수 있다
    world.players.g!.pos = { x: 10.5, y: 12.5 };
    expect(tryFlicker(world, 'g')).toBe(true);
  });
});

describe('tryChat / tryPing', () => {
  it('퀵챗 쿨타임 1초, 핑 쿨타임 3초', () => {
    const world = mkWorld();
    const a = world.players.a!;
    expect(tryChat(world, 'a', 2)).toBe(true);
    expect(a.cooldowns.chat).toBe(C.chatCooldown);
    tickCooldowns(a, 0.9);
    expect(tryChat(world, 'a', 2)).toBe(false);
    tickCooldowns(a, 0.1);
    expect(tryChat(world, 'a', 3)).toBe(true);

    expect(tryPing(world, 'a', { x: 4, y: 5 })).toBe(true);
    expect(a.cooldowns.ping).toBe(C.pingCooldown);
    tickCooldowns(a, 2.9);
    expect(tryPing(world, 'a', { x: 4, y: 5 })).toBe(false);
    tickCooldowns(a, 0.1);
    expect(tryPing(world, 'a', { x: 6, y: 7 })).toBe(true);

    expect(world.events).toEqual([
      { type: 'chat', playerId: 'a', index: 2 },
      { type: 'chat', playerId: 'a', index: 3 },
      { type: 'ping', playerId: 'a', floor: 0, pos: { x: 4, y: 5 } },
      { type: 'ping', playerId: 'a', floor: 0, pos: { x: 6, y: 7 } },
    ]);
  });

  it('유령도 핑과 퀵챗을 쓸 수 있다', () => {
    const world = mkWorld([], { floor: 1 });
    expect(tryChat(world, 'g', 0)).toBe(true);
    expect(tryPing(world, 'g', { x: 3, y: 4 })).toBe(true);
    expect(world.events).toEqual([
      { type: 'chat', playerId: 'g', index: 0 },
      { type: 'ping', playerId: 'g', floor: 1, pos: { x: 3, y: 4 } },
    ]);
  });

  it('잘못된 퀵챗 인덱스나 없는 플레이어는 거부하고 쿨타임을 쓰지 않는다', () => {
    const world = mkWorld();
    for (const bad of [-1, C.quickChats.length, 1.5, NaN, Infinity]) {
      expect(tryChat(world, 'a', bad)).toBe(false);
    }
    expect(world.players.a!.cooldowns.chat).toBe(0);
    expect(tryChat(world, 'nobody', 0)).toBe(false);
    expect(tryPing(world, 'nobody', { x: 1, y: 1 })).toBe(false);
    expect(world.events).toEqual([]);
    expect(tryChat(world, 'a', C.quickChats.length - 1)).toBe(true);
  });

  it('핑 이벤트는 위치를 복사한다', () => {
    const world = mkWorld();
    const pos = { x: 4, y: 5 };
    tryPing(world, 'a', pos);
    pos.x = 99;
    expect(world.events[0]).toEqual({ type: 'ping', playerId: 'a', floor: 0, pos: { x: 4, y: 5 } });
  });
});

describe('tickCooldowns', () => {
  it('각 쿨타임을 dt만큼 줄이되 0 아래로 내려가지 않는다', () => {
    const p = makePlayer({ cooldowns: { flicker: 10, ping: 0.5, chat: 0 } });
    tickCooldowns(p, 1);
    expect(p.cooldowns).toEqual({ flicker: 9, ping: 0, chat: 0 });
  });
});
