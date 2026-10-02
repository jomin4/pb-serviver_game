import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { isWalkableTile } from '../src/map/grid.ts';
import { applyPlayerMovement, applyStairs, moveCircle, playerSpeed, unstick } from '../src/movement.ts';
import type { ItemState } from '../src/types.ts';
import { carMap, open20, tinyMap as tiny } from './fixtures/maps.ts';
import { makeInput, makeItem, makePlayer } from './fixtures/world.ts';

const R = CONFIG.player.radius;
const p0 = makePlayer({ pos: { x: 5.5, y: 10.5 } });
const runRight = makeInput({ move: { x: 1, y: 0 }, run: true });
const walkRight = makeInput({ move: { x: 1, y: 0 } });

/** 무게 weight kg짜리 물건 하나(또는 여러 개)를 든 플레이어와 아이템 표. */
function carrying(...weights: number[]) {
  const items: Record<string, ItemState> = {};
  weights.forEach((w, i) => { items[`i${i}`] = makeItem(`i${i}`, w); });
  return { p: makePlayer({ inventory: Object.keys(items) }), items };
}

describe('moveCircle', () => {
  it('벽을 통과하지 못한다', () => {
    const p = moveCircle(tiny, 0, { x: 4.5, y: 3.5 }, { x: 2, y: 0 }, R);
    expect(p.x).toBeLessThanOrEqual(5 - R + 1e-9);
    expect(p.x).toBeCloseTo(5 - R);
    expect(p.y).toBe(3.5);
  });
  it('큰 delta도 벽을 뚫지 않는다', () => {
    const p = moveCircle(tiny, 0, { x: 4.5, y: 3.5 }, { x: 10, y: 0 }, R);
    expect(p.x).toBeLessThan(5);
  });
  it('차량 칸도 막힌다', () => {
    // 차량 (4,1) 왼쪽에서 오른쪽으로
    const right = moveCircle(carMap, 0, { x: 2.5, y: 1.5 }, { x: 5, y: 0 }, R);
    expect(right.x).toBeCloseTo(4 - R);
    // 위쪽 (4,0)에서 아래로
    const down = moveCircle(carMap, 0, { x: 4.5, y: 0.5 }, { x: 0, y: 5 }, R);
    expect(down.y).toBeCloseTo(1 - R);
  });
  it('벽에 막힌 축만 막히고 다른 축으로는 미끄러진다', () => {
    const p = moveCircle(tiny, 0, { x: 4.5, y: 3.5 }, { x: 2, y: -0.5 }, R);
    expect(p.x).toBeCloseTo(5 - R);
    expect(p.y).toBeCloseTo(3.0);
  });
  it('열린 공간에서는 delta만큼 정확히 이동한다', () => {
    const p = moveCircle(open20, 0, { x: 5.5, y: 5.5 }, { x: 1.3, y: -0.7 }, R);
    expect(p.x).toBeCloseTo(6.8);
    expect(p.y).toBeCloseTo(4.8);
  });
  it('반경이 다른 원(몬스터 0.4)도 같은 규칙으로 막힌다', () => {
    const p = moveCircle(tiny, 0, { x: 4.5, y: 3.5 }, { x: 2, y: 0 }, CONFIG.stalker.radius);
    expect(p.x).toBeCloseTo(5 - CONFIG.stalker.radius);
  });
  it('입력 위치를 변경하지 않는다', () => {
    const pos = { x: 4.5, y: 3.5 };
    moveCircle(tiny, 0, pos, { x: 2, y: 0 }, R);
    expect(pos).toEqual({ x: 4.5, y: 3.5 });
  });
});

describe('playerSpeed', () => {
  it('뛰기가 걷기보다 빠르다', () => {
    expect(playerSpeed(p0, {}, true)).toBe(5);
    expect(playerSpeed(p0, {}, false)).toBe(3);
  });
  it('무게 감속은 최대 30%', () => {
    const a = carrying(10);
    expect(playerSpeed(a.p, a.items, false)).toBeCloseTo(2.7);
    const b = carrying(15, 15, 15);
    expect(playerSpeed(b.p, b.items, false)).toBeCloseTo(2.1);
  });
  it('뛸 때도 무게 감속이 적용된다', () => {
    const a = carrying(10);
    expect(playerSpeed(a.p, a.items, true)).toBeCloseTo(4.5);
  });
  it('items에 없는 id는 무게 0', () => {
    expect(playerSpeed(makePlayer({ inventory: ['ghost'] }), {}, false)).toBe(3);
  });
});

describe('applyPlayerMovement', () => {
  it('스태미나 0이면 뛰지 못한다', () => {
    const p = applyPlayerMovement(open20, { ...p0, stamina: 0 }, runRight, {}, 1);
    expect(p.pos.x - p0.pos.x).toBeCloseTo(3);
    expect(p.stamina).toBe(1); // 못 뛰었으니 회복한다
  });
  it('뛰면 스태미나가 초당 1 줄고 멈추면 회복한다', () => {
    const ran = applyPlayerMovement(open20, p0, runRight, {}, 1);
    expect(ran.stamina).toBeCloseTo(4);
    expect(ran.pos.x - p0.pos.x).toBeCloseTo(5);
    const rested = applyPlayerMovement(open20, ran, makeInput(), {}, 1);
    expect(rested.stamina).toBeCloseTo(5);
  });
  it('뛰기 키를 눌러도 가만히 서 있으면 스태미나가 줄지 않는다', () => {
    const p = applyPlayerMovement(open20, { ...p0, stamina: 3 }, makeInput({ run: true }), {}, 1);
    expect(p.stamina).toBeCloseTo(4);
    expect(p.pos).toEqual(p0.pos);
  });
  it('스태미나는 0과 최대치 사이로 제한된다', () => {
    const drained = applyPlayerMovement(open20, { ...p0, stamina: 0.2 }, runRight, {}, 1);
    expect(drained.stamina).toBe(0);
    expect(drained.exhausted).toBe(true);
    const full = applyPlayerMovement(open20, p0, makeInput(), {}, 10);
    expect(full.stamina).toBe(CONFIG.player.staminaMax);
  });
  it('입력 PlayerState를 변경하지 않는다', () => {
    const before = JSON.parse(JSON.stringify(p0)) as typeof p0;
    const out = applyPlayerMovement(open20, p0, runRight, {}, 1);
    expect(p0).toEqual(before);
    expect(out).not.toBe(p0);
    expect(out.pos).not.toBe(p0.pos);
  });
  it('들고 있는 물건 무게만큼 느려진다', () => {
    const a = carrying(10);
    const p = applyPlayerMovement(open20, { ...a.p, pos: p0.pos }, walkRight, a.items, 1);
    expect(p.pos.x - p0.pos.x).toBeCloseTo(2.7);
  });
  it('벽 앞에서 멈춘다', () => {
    const p = applyPlayerMovement(tiny, makePlayer({ pos: { x: 4.5, y: 3.5 } }), walkRight, {}, 1);
    expect(p.pos.x).toBeCloseTo(5 - R);
  });
  it('이동 입력이 없으면 위치가 그대로다', () => {
    const p = applyPlayerMovement(open20, p0, makeInput(), {}, 1);
    expect(p.pos).toEqual(p0.pos);
  });
});

describe('탈진(exhausted)', () => {
  const dt = 0.05;
  const tick = (p: ReturnType<typeof makePlayer>) => applyPlayerMovement(open20, p, runRight, {}, dt);

  it('뛰다가 스태미나가 0이 되면 exhausted가 된다', () => {
    let p = makePlayer({ pos: { x: 2.5, y: 10.5 }, stamina: 0.1 });
    p = tick(p);
    expect(p.stamina).toBeCloseTo(0.05);
    expect(p.exhausted).toBe(false);
    p = tick(p);
    expect(p.stamina).toBeCloseTo(0);
    expect(p.exhausted).toBe(true);
  });
  it('스태미나 0에서 뛰기를 누르고 있어도 회복될 때까지 걷기 속도로 균일하게 움직인다(교대 없음)', () => {
    let p = makePlayer({ pos: { x: 2.5, y: 10.5 }, stamina: 0 });
    const startX = p.pos.x;
    let ticks = 0;
    while (ticks < 40) {
      const before = p;
      p = tick(p);
      ticks++;
      if (!p.exhausted) break;
      // 탈진 중에는 매 틱 정확히 걷기 거리만 간다
      expect(p.pos.x - before.pos.x).toBeCloseTo(CONFIG.player.walkSpeed * dt);
    }
    expect(p.exhausted).toBe(false);
    expect(p.stamina).toBeGreaterThanOrEqual(CONFIG.player.staminaRecoverToRun - 1e-9);
    // staminaRecoverToRun(1)까지 회복하는 1초 동안 걸은 거리 = 3타일
    expect(p.pos.x - startX).toBeCloseTo(CONFIG.player.walkSpeed * 1, 1);
  });
  it('회복 기준 이상이 되면 다시 뛴다', () => {
    let p = makePlayer({ pos: { x: 2.5, y: 10.5 }, stamina: 0 });
    for (let i = 0; i < 40 && (i === 0 || p.exhausted); i++) p = tick(p);
    expect(p.exhausted).toBe(false);
    const before = p;
    p = tick(p);
    expect(p.pos.x - before.pos.x).toBeCloseTo(CONFIG.player.runSpeed * dt);
    expect(p.stamina).toBeLessThan(before.stamina);
  });
  it('탈진 중 stamina가 recover 미만이면 멈춰도 exhausted가 유지된다', () => {
    const p = applyPlayerMovement(open20, makePlayer({ stamina: 0, exhausted: true }), makeInput(), {}, 0.5);
    expect(p.stamina).toBeCloseTo(0.5);
    expect(p.exhausted).toBe(true);
  });
});

describe('계단', () => {
  const down = makeInput({ move: { x: 0, y: 1 } });

  it('계단에 들어서면 짝 계단으로 이동하고 바로 되돌아가지 않는다', () => {
    const start = makePlayer({ pos: { x: 2.5, y: 3.5 } });
    const t1 = applyPlayerMovement(tiny, start, down, {}, 0.2); // y 3.5 → 4.1, 계단 (2,4)
    expect(t1.floor).toBe(1);
    expect(t1.pos).toEqual({ x: 7.5, y: 1.5 });
    expect(t1.onStairs).toBe(true);
    // 두 번째 틱: 도착한 계단 칸 위에서 제자리 + 칸 안에서 움직여도 floor는 그대로
    const t2 = applyPlayerMovement(tiny, t1, makeInput(), {}, 0.05);
    expect(t2.floor).toBe(1);
    const t3 = applyPlayerMovement(tiny, t2, makeInput({ move: { x: 0.1, y: 0 } }), {}, 0.05);
    expect(t3.floor).toBe(1);
    expect(t3.onStairs).toBe(true);
  });
  it('계단 칸을 벗어나면 onStairs가 풀리고 다시 들어가면 다시 이동한다', () => {
    const arrived = applyPlayerMovement(tiny, makePlayer({ pos: { x: 2.5, y: 3.5 } }), down, {}, 0.2);
    const left = applyPlayerMovement(tiny, arrived, makeInput({ move: { x: -1, y: 0 } }), {}, 0.5); // (7.5 → 6.0)
    expect(left.floor).toBe(1);
    expect(left.onStairs).toBe(false);
    const back = applyPlayerMovement(tiny, left, makeInput({ move: { x: 1, y: 0 } }), {}, 0.5);
    expect(back.floor).toBe(0);
    expect(back.pos).toEqual({ x: 2.5, y: 4.5 });
    expect(back.onStairs).toBe(true);
  });
  it('applyStairs는 계단이 아닌 칸에서는 아무 일도 하지 않는다', () => {
    const p = makePlayer({ pos: { x: 3.5, y: 2.5 } });
    expect(applyStairs(tiny, p)).toEqual(p);
  });
  it('applyStairs는 입력을 변경하지 않는다', () => {
    const p = makePlayer({ pos: { x: 2.5, y: 4.5 } });
    const out = applyStairs(tiny, p);
    expect(p.floor).toBe(0);
    expect(p.onStairs).toBe(false);
    expect(out.floor).toBe(1);
  });
});

describe('unstick', () => {
  it('unstick은 벽 안의 점을 가장 가까운 빈 칸으로', () => {
    const out = unstick(tiny, 0, { x: 5.5, y: 3.5 }, R);
    expect(isWalkableTile(tiny, 0, Math.floor(out.x), Math.floor(out.y))).toBe(true);
    // 가장 가까운 칸 중 하나(좌 (4,3) 또는 우 (6,3))의 중심
    expect(Math.abs(out.x - 5.5)).toBeCloseTo(1);
    expect(out.y).toBe(3.5);
  });
  it('겹치지 않으면 그대로 돌려준다', () => {
    const pos = { x: 3.2, y: 2.7 };
    expect(unstick(tiny, 0, pos, R)).toEqual(pos);
  });
  it('벽에 걸쳐 있는 원도 빈 칸 중심으로 옮긴다', () => {
    const out = unstick(tiny, 0, { x: 4.9, y: 3.5 }, R); // 중심은 (4,3)이지만 벽 (5,3)과 겹침
    expect(out).toEqual({ x: 4.5, y: 3.5 });
  });
});
