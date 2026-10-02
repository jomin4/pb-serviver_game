import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { step } from '../src/step.ts';
import type { PlayerInput, World } from '../src/types.ts';
import { makeInput, makeItem, makeParkingWorld, makeStalker } from './fixtures/world.ts';

const DT = 0.05;

/** 입력을 매 틱 새 seq로 보내며 `ticks`틱 진행한다. */
function simulate(
  start: World,
  ticks: number,
  inputsAt: (tick: number) => Record<string, Partial<PlayerInput>>,
  after?: (w: World, tick: number) => void,
): World {
  let w = start;
  for (let t = 0; t < ticks; t++) {
    const batch: Record<string, PlayerInput[]> = {};
    for (const [id, partial] of Object.entries(inputsAt(t))) {
      batch[id] = [makeInput({ ...partial, seq: w.players[id]!.lastSeq + 1 })];
    }
    w = step(w, batch, DT);
    after?.(w, t);
  }
  return w;
}

describe('시나리오', () => {
  /**
   * 트럭 구역: A (3.5, 34.5)가 폐품을 들고 있고, 시선형이 (9.5, 34.5)에 있다. B (4.5, 36.5)가
   * 시선형 쪽(위 방향 대각선)을 본다. 거리 약 5.4: 사거리 8 안.
   */
  const standoff = (): World => {
    const w = makeParkingWorld(['a', 'b']);
    w.round.target = 40;
    w.items.scrap = makeItem('scrap', 5, { value: 50, carriedBy: 'a' });
    w.players.a!.inventory = ['scrap'];
    w.players.a!.pos = { x: 3.5, y: 34.5 };
    w.players.b!.pos = { x: 4.5, y: 36.5 };
    w.players.b!.aim = Math.atan2(34.5 - 36.5, 9.5 - 4.5);
    w.watcher = { ...w.watcher, active: true, floor: 0, pos: { x: 9.5, y: 34.5 } };
    return w;
  };

  it('B가 시선형을 비추는 동안 A가 폐품을 실으면 총액이 늘고 둘 다 생존', () => {
    const w = standoff();
    const start = { ...w.watcher.pos };
    const out = simulate(
      w,
      60,
      (t) => ({
        a: { interact: t === 0 }, // 첫 틱에 누르고 뗀다(적재)
        b: { toggleFlashlight: t === 0, aim: w.players.b!.aim },
      }),
      (cur) => {
        expect(cur.watcher.frozen).toBe(true);
        expect(cur.players.a!.alive && cur.players.b!.alive).toBe(true);
      },
    );
    expect(out.round.truckTotal).toBe(50);
    expect(out.items.scrap!.loaded).toBe(true);
    expect(out.watcher.pos).toEqual(start);
    expect(out.round.phase).toBe('playing');
  });

  it('비추지 않으면 시선형이 다가와 죽인다(대조군)', () => {
    const out = simulate(standoff(), 60, (t) => ({ a: { interact: t === 0 } }));
    const dead = Object.values(out.players).filter(p => !p.alive);
    expect(dead.length).toBeGreaterThan(0);
  });

  /** B1 위쪽 방(x 3..10, y 3..8) 안의 플레이어와, 벽(y=2) 건너편 복도의 추적형. 거리 4, 시야 차단. */
  const noiseSetup = (): World => {
    const w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 4.5, y: 5.5 };
    w.stalkers.push(makeStalker({ pos: { x: 4.5, y: 1.5 }, floor: 0 }));
    return w;
  };

  it('뛰면 추적형이 조사하러 온다', () => {
    const out = step(noiseSetup(), { a: [makeInput({ seq: 1, move: { x: 1, y: 0 }, run: true })] }, DT);
    expect(out.stalkers[0]!.mode).toBe('investigate');
    expect(out.stalkers[0]!.goal).not.toBeNull();
    expect(out.events.some(e => e.type === 'noise' && e.radius === CONFIG.noise.run)).toBe(true);
  });

  it('걸으면(반경 1.5) 추적형은 듣지 못한다', () => {
    const out = step(noiseSetup(), { a: [makeInput({ seq: 1, move: { x: 1, y: 0 } })] }, DT);
    expect(out.stalkers[0]!.mode).toBe('patrol');
  });

  it('조사하러 온 추적형이 플레이어를 발견하면 추격하다 한 번 때리고 물러난다', () => {
    let w = noiseSetup();
    w = simulate(w, 1, () => ({ a: { move: { x: 1, y: 0 }, run: true } }));
    expect(w.stalkers[0]!.mode).toBe('investigate');
    // 플레이어는 가만히 서 있고 추적형이 도착한다
    let damaged = 0;
    w = simulate(w, 400, () => ({ a: {} }), (cur) => { damaged += cur.events.filter(e => e.type === 'damage').length; });
    expect(damaged).toBeGreaterThanOrEqual(1);
    expect(w.players.a!.hp).toBeLessThan(CONFIG.player.hp);
  });

  it('줍기 → 적재 → 전원 출발 누름 → 성공', () => {
    const w = makeParkingWorld(['a']);
    w.round.target = 30;
    w.items.scrap = makeItem('scrap', 5, { value: 60, pos: { x: 3.5, y: 31.5 } });
    w.players.a!.pos = { x: 3.5, y: 31.5 }; // 구역(y ≥ 33) 위쪽 바깥
    let cur = simulate(w, 1, () => ({ a: { interact: true } }));
    expect(cur.players.a!.inventory).toEqual(['scrap']);
    cur = simulate(cur, 1, () => ({ a: { interact: false } }));
    cur = simulate(cur, 20, () => ({ a: { move: { x: 0, y: 1 } } })); // 1초, 약 2.9타일 아래로
    expect(cur.players.a!.pos.y).toBeGreaterThan(33);
    cur = simulate(cur, 1, () => ({ a: { interact: true } })); // 적재(엣지)
    expect(cur.round.truckTotal).toBe(60);
    // 누른 채로 3초 유지
    cur = simulate(cur, 80, () => ({ a: { interact: true } }));
    expect(cur.round.phase).toBe('success');
  });
});
