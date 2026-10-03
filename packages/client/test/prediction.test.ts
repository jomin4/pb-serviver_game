import { describe, expect, it } from 'vitest';
import { applyPlayerMovement, CONFIG, EMPTY_INPUT } from '@bh/shared';
import type { ItemState, MapData, PlayerInput, PlayerState } from '@bh/shared';
import { createPredictor } from '../src/sim/prediction.ts';

/** 20×5 열린 방(오른쪽 끝 벽) 한 층짜리 맵. 이 테스트에 필요한 필드만 채운다. */
const row = (w: number): string => `#${'.'.repeat(w - 2)}#`;
const rows = ['#'.repeat(20), row(20), row(20), row(20), '#'.repeat(20)];
const floor = { width: 20, height: 5, rows };
const map = {
  id: 'open', floors: [floor, floor], truckZone: { x: 1, y: 1, w: 1, h: 1 }, spawns: [], itemSlots: [],
  patrolRoutes: [], lights: [], stairs: [], zones: [],
} as unknown as MapData;

const items: Record<string, ItemState> = {};
const self = (p: Partial<PlayerState> = {}): PlayerState => ({
  id: 'me', name: 'me', pos: { x: 2.5, y: 2.5 }, floor: 0, aim: 0, flashlightOn: false, battery: 180, hp: 3,
  stamina: CONFIG.player.staminaMax, alive: true, inventory: [], selectedSlot: 0, lastSeq: 0, interactHeld: 0,
  prevInteract: false, onStairs: false, exhausted: false, connected: true,
  cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 0, ...p,
});
const right = (seq: number): PlayerInput => ({ ...EMPTY_INPUT(seq), move: { x: 1, y: 0 } });

describe('predictor', () => {
  it('apply는 shared 이동을 그대로 적용한다', () => {
    const pr = createPredictor(map);
    const p = self();
    expect(pr.apply(right(1), p, items, 0.05)).toEqual(applyPlayerMovement(map, p, right(1), items, 0.05));
  });
  it('apply는 보낸 입력을 보관한다', () => {
    const pr = createPredictor(map);
    let p = self();
    p = pr.apply(right(1), p, items, 0.016);
    p = pr.apply(right(2), p, items, 0.016);
    expect(pr.pendingCount()).toBe(2);
  });
  it('reconcile은 서버 위치에서 미처리 입력을 다시 적용한다', () => {
    const pr = createPredictor(map);
    const dt = 0.05;
    let predicted = self();
    for (let seq = 1; seq <= 5; seq++) predicted = pr.apply(right(seq), predicted, items, dt);
    // 서버는 2번까지 처리했고, 그 위치는 클라이언트 예측과 약간 다르다(서버에서 밀림 등).
    const server = self({ pos: { x: 2.5 + 0.1, y: 2.5 }, lastSeq: 2 });
    const out = pr.reconcile(server, items);
    let expected = server;
    for (let seq = 3; seq <= 5; seq++) expected = applyPlayerMovement(map, expected, right(seq), items, dt);
    expect(out.pos).toEqual(expected.pos);
    expect(out.stamina).toBe(expected.stamina);
    expect(pr.pendingCount()).toBe(3);
  });
  it('각 입력을 만들 때 쓴 dt로 다시 적용한다', () => {
    const pr = createPredictor(map);
    let p = self();
    p = pr.apply(right(1), p, items, 0.02);
    p = pr.apply(right(2), p, items, 0.08);
    const server = self({ lastSeq: 0 });
    const out = pr.reconcile(server, items);
    const walk = CONFIG.player.walkSpeed;
    expect(out.pos.x).toBeCloseTo(2.5 + walk * 0.1);
  });
  it('서버가 모두 처리했으면 서버 상태 그대로, 대기열은 빈다', () => {
    const pr = createPredictor(map);
    let p = self();
    p = pr.apply(right(1), p, items, 0.05);
    p = pr.apply(right(2), p, items, 0.05);
    const server = self({ pos: { x: 3, y: 2.5 }, lastSeq: 2 });
    expect(pr.reconcile(server, items)).toEqual(server);
    expect(pr.pendingCount()).toBe(0);
  });
  it('서버 lastSeq보다 앞선 입력은 다시 적용하지 않는다(중복 적용 없음)', () => {
    const pr = createPredictor(map);
    let p = self();
    for (let seq = 1; seq <= 3; seq++) p = pr.apply(right(seq), p, items, 0.05);
    pr.reconcile(self({ lastSeq: 3 }), items);
    const again = pr.reconcile(self({ lastSeq: 3, pos: { x: 4, y: 2.5 } }), items);
    expect(again.pos).toEqual({ x: 4, y: 2.5 });
  });
  it('서버 상태가 같은 틱에 오면 예측과 서버가 일치(오차 없음)', () => {
    const pr = createPredictor(map);
    let predicted = self();
    let server = self();
    for (let seq = 1; seq <= 3; seq++) {
      predicted = pr.apply(right(seq), predicted, items, 0.05);
      server = { ...applyPlayerMovement(map, server, right(seq), items, 0.05), lastSeq: seq };
    }
    const out = pr.reconcile(server, items);
    expect(out).toEqual(server);
    expect(predicted.pos).toEqual(server.pos);
  });
  it('벽에 막히는 것도 같은 규칙으로 보정된다', () => {
    const pr = createPredictor(map);
    const start = self({ pos: { x: 18.4, y: 2.5 } });
    let p = start;
    for (let seq = 1; seq <= 10; seq++) p = pr.apply(right(seq), p, items, 0.05);
    expect(p.pos.x).toBeLessThan(19);
    const out = pr.reconcile({ ...start, lastSeq: 0 }, items);
    expect(out.pos.x).toBeCloseTo(p.pos.x);
  });
  it('dt는 서버 한도(maxDt)로 제한한다', () => {
    const pr = createPredictor(map);
    const p = pr.apply(right(1), self(), items, 5);
    expect(p.pos.x).toBeCloseTo(2.5 + CONFIG.player.walkSpeed * CONFIG.net.maxDt);
  });
  it('유령은 예측하지 않고 서버 상태를 그대로 쓴다', () => {
    const pr = createPredictor(map);
    const ghost = self({ alive: false });
    expect(pr.apply(right(1), ghost, items, 0.05)).toBe(ghost);
    expect(pr.pendingCount()).toBe(0);
    const server = self({ alive: false, pos: { x: 9, y: 2.5 }, lastSeq: 0 });
    expect(pr.reconcile(server, items)).toBe(server);
  });
  it('살아있다가 서버에서 유령이 되면 대기열을 비우고 서버 상태를 쓴다', () => {
    const pr = createPredictor(map);
    pr.apply(right(1), self(), items, 0.05);
    const server = self({ alive: false, lastSeq: 0 });
    expect(pr.reconcile(server, items)).toBe(server);
    expect(pr.pendingCount()).toBe(0);
  });
  it('서버가 보낸 뒤에도 입력이 없으면 서버 상태 그대로', () => {
    const pr = createPredictor(map);
    const server = self({ lastSeq: 7 });
    expect(pr.reconcile(server, items)).toEqual(server);
  });
});
