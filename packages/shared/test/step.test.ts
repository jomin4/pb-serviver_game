import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { getMap } from '../src/map/index.ts';
import { createWorld } from '../src/round.ts';
import { cloneWorld, step } from '../src/step.ts';
import type { GameEvent, PlayerInput, World } from '../src/types.ts';
import { overlapsSolid } from './fixtures/overlap.ts';
import { makeInput, makeItem, makeParkingWorld, makeStalker } from './fixtures/world.ts';

const DT = 0.05;
const RUN = CONFIG.noise.run;
const WALK = CONFIG.noise.walk;

const noises = (w: World): Extract<GameEvent, { type: 'noise' }>[] =>
  w.events.filter((e): e is Extract<GameEvent, { type: 'noise' }> => e.type === 'noise');
const ofType = <T extends GameEvent['type']>(w: World, type: T): Extract<GameEvent, { type: T }>[] =>
  w.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** 같은 시드와 스크립트로 n틱 진행한 월드. */
function run(seed: number, ticks: number): World {
  let w = createWorld({ mapId: 'parking-lot', seed, players: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] });
  for (let t = 0; t < ticks; t++) {
    const script = (k: number): PlayerInput[] => [makeInput({
      seq: t + 1,
      move: { x: Math.cos((t + k) / 7), y: Math.sin((t + k) / 5) },
      run: (t + k) % 11 < 4,
      aim: (t + k) / 9,
      toggleFlashlight: t % 37 === k,
      interact: t % 13 < 3,
      drop: t % 29 === 5,
      chat: t % 41 === 3 ? 1 : null,
    })];
    w = step(w, { a: script(0), b: script(3) }, DT);
  }
  return w;
}

describe('step: 결정성과 입력 보존', () => {
  it('같은 시드·입력이면 결과가 같다', () => {
    expect(run(7, 300)).toEqual(run(7, 300));
  });

  it('시드가 다르면 결과가 다르다', () => {
    expect(run(7, 50)).not.toEqual(run(8, 50));
  });

  it('입력 world를 변경하지 않고 새 world를 돌려준다', () => {
    const w = makeParkingWorld(['a', 'b']);
    w.stalkers.push(makeStalker());
    const snapshot = cloneWorld(w);
    const out = step(w, { a: [makeInput({ seq: 1, move: { x: 1, y: 0 }, chat: 2 })] }, DT);
    expect(w).toEqual(snapshot);
    expect(out).not.toBe(w);
    expect(out.tick).toBe(1);
  });

  it('cloneWorld는 JSON 왕복과 같은 깊은 복사다', () => {
    const w = makeParkingWorld(['a', 'b']);
    w.items.i1 = makeItem('i1', 5, { carriedBy: 'a' });
    w.players.a!.inventory = ['i1'];
    w.stalkers.push(makeStalker({ goal: { x: 1, y: 2 }, path: [{ x: 3, y: 4 }] }));
    w.watcher.path = [{ floor: 1, pos: { x: 5, y: 6 } }];
    w.lights.push({ id: 'L', floor: 0, pos: { x: 7, y: 8 }, radius: 3, on: true, flickering: false, flickerUntil: 0 });
    w.events = [{ type: 'ping', playerId: 'a', floor: 0, pos: { x: 1, y: 1 } }, { type: 'flicker', lightIds: ['L'] }, { type: 'noise', floor: 0, pos: { x: 2, y: 2 }, radius: 3 }, { type: 'horn' }];
    const snapshot: World = JSON.parse(JSON.stringify(w));
    const c = cloneWorld(w);
    expect(c).toEqual(snapshot);
    // 어디도 참조를 공유하지 않는다
    c.players.a!.pos.x = 99;
    c.players.a!.inventory.push('x');
    c.players.a!.cooldowns.chat = 9;
    c.items.i1!.pos.x = 99;
    c.stalkers[0]!.goal!.x = 99;
    c.stalkers[0]!.path[0]!.x = 99;
    c.watcher.path[0]!.pos.x = 99;
    c.lights[0]!.pos.x = 99;
    c.round.clock = 99;
    (c.events[0] as { pos: { x: number } }).pos.x = 99;
    (c.events[1] as { lightIds: string[] }).lightIds.push('M');
    (c.events[2] as { pos: { x: number } }).pos.x = 99;
    expect(w).toEqual(snapshot);
  });
});

describe('step: 시간과 phase', () => {
  it('dt는 0.1로 제한', () => {
    const w = makeParkingWorld(['a']);
    const out = step(w, {}, 5);
    expect(out.time).toBeCloseTo(0.1, 10);
    expect(out.tick).toBe(1);
    expect(out.round.clock).toBeCloseTo(0.1 / CONFIG.realSecondsPerGameMinute, 10);
  });

  it('events는 틱마다 비운다', () => {
    const w = makeParkingWorld(['a']);
    w.events = [{ type: 'horn' }];
    expect(step(w, {}, DT).events).toEqual([]);
  });

  it('playing이 아니면 아무것도 바뀌지 않는다', () => {
    for (const phase of ['success', 'fail'] as const) {
      const w = makeParkingWorld(['a']);
      w.round.phase = phase;
      const snapshot = cloneWorld(w);
      const out = step(w, { a: [makeInput({ seq: 1, move: { x: 1, y: 0 } })] }, DT);
      expect(out).toBe(w);
      expect(w).toEqual(snapshot);
    }
  });

  it('쿨타임은 틱마다 줄어든다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.cooldowns.chat = 1;
    expect(step(w, {}, DT).players.a!.cooldowns.chat).toBeCloseTo(0.95, 10);
  });
});

describe('step: 입력 선별', () => {
  it('이미 처리한 seq는 무시', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.lastSeq = 5;
    const out = step(w, { a: [makeInput({ seq: 5, move: { x: 1, y: 0 } }), makeInput({ seq: 3, move: { x: 1, y: 0 } })] }, DT);
    expect(out.players.a!.pos).toEqual(w.players.a!.pos);
    expect(out.players.a!.lastSeq).toBe(5);
  });

  it('seq 순으로 정렬해 적용하고 lastSeq를 갱신', () => {
    const w = makeParkingWorld(['a']);
    const start = w.players.a!.pos.x;
    const inputs = [8, 6, 7].map(seq => makeInput({ seq, move: { x: 1, y: 0 } }));
    const out = step(w, { a: inputs }, DT);
    expect(out.players.a!.lastSeq).toBe(8);
    // 입력이 몇 개든 총 이동 시간은 dt
    expect(out.players.a!.pos.x - start).toBeCloseTo(CONFIG.player.walkSpeed * DT, 6);
  });

  it('같은 seq가 두 번 오면 한 번만 적용', () => {
    const w = makeParkingWorld(['a']);
    const out = step(w, { a: [makeInput({ seq: 1, chat: 0 }), makeInput({ seq: 1, chat: 1 })] }, DT);
    expect(ofType(out, 'chat')).toEqual([{ type: 'chat', playerId: 'a', index: 0 }]);
  });

  it('입력은 마지막 10개만 쓴다', () => {
    const many = Array.from({ length: 12 }, (_, i) => makeInput({ seq: i + 1, chat: i === 0 ? 1 : null }));
    const out = step(makeParkingWorld(['a']), { a: many }, DT);
    expect(ofType(out, 'chat')).toEqual([]);
    expect(out.players.a!.lastSeq).toBe(12);

    const ten = many.slice(2).map((m, i) => ({ ...m, chat: i === 0 ? (1 as const) : null }));
    expect(ofType(step(makeParkingWorld(['a']), { a: ten }, DT), 'chat')).toHaveLength(1);
  });

  it('입력이 없으면 중립 입력을 쓴다: 가만히 서 있고 aim은 그대로', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.aim = 1.2;
    const out = step(w, {}, DT);
    expect(out.players.a!.pos).toEqual(w.players.a!.pos);
    expect(out.players.a!.aim).toBe(1.2);
    expect(noises(out)).toEqual([]);
  });

  it('입력이 없는 틱에도 누르고 있던 상호작용은 유지된다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.prevInteract = true;
    let cur = w;
    for (let i = 0; i < 3; i++) cur = step(cur, {}, DT);
    expect(cur.players.a!.interactHeld).toBeCloseTo(3 * DT, 10);
    expect(cur.players.a!.prevInteract).toBe(true);
    // 누르고 있지 않았다면 누적되지 않는다
    const idle = step(makeParkingWorld(['a']), {}, DT);
    expect(idle.players.a!.interactHeld).toBe(0);
  });

  it('모르는 플레이어 id의 입력은 무시한다', () => {
    const w = makeParkingWorld(['a']);
    expect(() => step(w, { ghost: [makeInput({ seq: 1 })] }, DT)).not.toThrow();
  });
});

describe('step: 손전등과 배터리', () => {
  it('배터리가 0이면 켜지지 않는다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.battery = 0;
    const out = step(w, { a: [makeInput({ seq: 1, toggleFlashlight: true })] }, DT);
    expect(out.players.a!.flashlightOn).toBe(false);
  });

  it('토글로 켜고 끈다. 켜져 있으면 초당 1 소모', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 20.5, y: 20.5 }; // 트럭 구역 밖(충전 없음)
    const on = step(w, { a: [makeInput({ seq: 1, toggleFlashlight: true })] }, DT);
    expect(on.players.a!.flashlightOn).toBe(true);
    expect(on.players.a!.battery).toBeCloseTo(CONFIG.flashlight.batteryMax - DT * CONFIG.flashlight.drainPerSecond, 10);
    const off = step(on, { a: [makeInput({ seq: 2, toggleFlashlight: true })] }, DT);
    expect(off.players.a!.flashlightOn).toBe(false);
    expect(off.players.a!.battery).toBe(on.players.a!.battery);
  });

  it('배터리가 바닥나면 0이 되고 꺼진다', () => {
    let w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 20.5, y: 20.5 };
    w.players.a!.flashlightOn = true;
    w.players.a!.battery = 0.06;
    w = step(w, {}, DT);
    expect(w.players.a!.flashlightOn).toBe(true);
    w = step(w, {}, DT);
    expect(w.players.a!.battery).toBe(0);
    expect(w.players.a!.flashlightOn).toBe(false);
  });

  it('트럭 구역에서는 충전된다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.battery = 50;
    expect(step(w, {}, DT).players.a!.battery).toBe(CONFIG.flashlight.batteryMax);
  });
});

describe('step: 소음', () => {
  const walk = (extra: Partial<PlayerInput>): PlayerInput => makeInput({ seq: 1, move: { x: 1, y: 0 }, ...extra });

  it('뛰면 run 반경, 걸으면 walk 반경, 서 있으면 소음 없음 (최종 위치에서 한 번)', () => {
    const w = makeParkingWorld(['a']);
    const ran = step(w, { a: [walk({ run: true })] }, DT);
    expect(noises(ran)).toEqual([{ type: 'noise', floor: 0, pos: ran.players.a!.pos, radius: RUN }]);
    const walked = step(w, { a: [walk({})] }, DT);
    expect(noises(walked)).toEqual([{ type: 'noise', floor: 0, pos: walked.players.a!.pos, radius: WALK }]);
    expect(noises(step(w, { a: [makeInput({ seq: 1 })] }, DT))).toEqual([]);
  });

  it('여러 입력이 있어도 틱당 한 번만 낸다', () => {
    const inputs = [1, 2, 3].map(seq => walk({ seq, run: true }));
    expect(noises(step(makeParkingWorld(['a']), { a: inputs }, DT))).toHaveLength(1);
  });

  it('0.01타일 미만 움직임은 소음이 아니다', () => {
    const out = step(makeParkingWorld(['a']), { a: [walk({ move: { x: 0.001, y: 0 } })] }, DT);
    expect(noises(out)).toEqual([]);
  });

  it('탈진해서 뛰지 못하면 걷는 소음', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.stamina = 0;
    w.players.a!.exhausted = true;
    const out = step(w, { a: [walk({ run: true })] }, DT);
    expect(noises(out).map(n => n.radius)).toEqual([WALK]);
  });

  it('벽에 막혀 움직이지 못하면 소음이 없다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 1 + CONFIG.player.radius, y: 20.5 };
    const out = step(w, { a: [walk({ move: { x: -1, y: 0 } })] }, DT);
    expect(noises(out)).toEqual([]);
  });

  it('유령은 소음을 내지 않는다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.alive = false;
    expect(noises(step(w, { a: [walk({ run: true })] }, DT))).toEqual([]);
  });
});

describe('step: 버리기, 퀵챗, 핑', () => {
  it('drop 엣지: 선택 칸 폐품을 떨어뜨리고 drop 소음', () => {
    const w = makeParkingWorld(['a']);
    w.items.i1 = makeItem('i1', 5, { carriedBy: 'a' });
    w.players.a!.inventory = ['i1'];
    const out = step(w, { a: [makeInput({ seq: 1, drop: true })] }, DT);
    expect(out.players.a!.inventory).toEqual([]);
    expect(out.items.i1!.carriedBy).toBeNull();
    expect(out.items.i1!.pos).toEqual(out.players.a!.pos);
    expect(noises(out)).toEqual([{ type: 'noise', floor: 0, pos: out.players.a!.pos, radius: CONFIG.noise.drop }]);
  });

  it('버릴 것이 없으면 소음도 없다', () => {
    const out = step(makeParkingWorld(['a']), { a: [makeInput({ seq: 1, drop: true })] }, DT);
    expect(noises(out)).toEqual([]);
  });

  it('selectSlot이 먼저 적용되어 그 칸을 버린다', () => {
    const w = makeParkingWorld(['a']);
    w.items.i1 = makeItem('i1', 5, { carriedBy: 'a' });
    w.items.i2 = makeItem('i2', 5, { carriedBy: 'a' });
    w.players.a!.inventory = ['i1', 'i2'];
    const out = step(w, { a: [makeInput({ seq: 1, selectSlot: 1, drop: true })] }, DT);
    expect(out.players.a!.inventory).toEqual(['i1']);
    expect(out.items.i2!.carriedBy).toBeNull();
  });

  it('퀵챗 이벤트와 쿨타임', () => {
    const w = makeParkingWorld(['a']);
    const out = step(w, { a: [makeInput({ seq: 1, chat: 3 })] }, DT);
    expect(ofType(out, 'chat')).toEqual([{ type: 'chat', playerId: 'a', index: 3 }]);
    const again = step(out, { a: [makeInput({ seq: 2, chat: 3 })] }, DT);
    expect(ofType(again, 'chat')).toEqual([]);
  });

  it('핑 좌표는 자기 층 경계 안으로 제한된다', () => {
    const w = makeParkingWorld(['a']);
    const out = step(w, { a: [makeInput({ seq: 1, ping: { x: -5, y: 9999 } })] }, DT);
    const { width, height } = { width: 60, height: 40 };
    expect(ofType(out, 'ping')).toEqual([{ type: 'ping', playerId: 'a', floor: 0, pos: { x: 0, y: height } }]);
    const w2 = makeParkingWorld(['a']);
    const out2 = step(w2, { a: [makeInput({ seq: 1, ping: { x: width + 3, y: 12.5 } })] }, DT);
    expect(ofType(out2, 'ping')[0]!.pos).toEqual({ x: width, y: 12.5 });
    const out3 = step(makeParkingWorld(['a']), { a: [makeInput({ seq: 1, ping: { x: 10, y: 12.5 } })] }, DT);
    expect(ofType(out3, 'ping')[0]!.pos).toEqual({ x: 10, y: 12.5 });
  });
});

describe('step: 유령', () => {
  const ghostWorld = (): World => {
    const w = makeParkingWorld(['a', 'b']);
    w.players.a!.alive = false;
    w.players.b!.pos = { x: 30.5, y: 20.5 };
    return w;
  };

  it('유령은 벽을 무시하고 유령 속도로 움직인다', () => {
    const w = ghostWorld();
    w.players.a!.pos = { x: 1.5, y: 20.5 };
    const out = step(w, { a: [makeInput({ seq: 1, move: { x: -1, y: 0 } })] }, DT);
    expect(out.players.a!.pos.x).toBeCloseTo(1.5 - CONFIG.ghost.speed * DT, 6);
  });

  it('유령은 끼임 해소 대상이 아니다', () => {
    const w = ghostWorld();
    w.players.a!.pos = { x: 0.5, y: 0.5 };
    expect(step(w, {}, DT).players.a!.pos).toEqual({ x: 0.5, y: 0.5 });
  });

  it('유령은 손전등·버리기·상호작용을 쓸 수 없다', () => {
    const w = ghostWorld();
    const out = step(w, { a: [makeInput({ seq: 1, toggleFlashlight: true, drop: true, interact: true })] }, DT);
    expect(out.players.a!.flashlightOn).toBe(false);
    expect(noises(out)).toEqual([]);
  });

  it('유령 깜빡이기는 가까운 조명에 통한다', () => {
    const w = ghostWorld();
    w.lights.push({ id: 'L1', floor: 0, pos: { x: 3.5, y: 34.5 }, radius: 5, on: true, flickering: false, flickerUntil: 0 });
    const out = step(w, { a: [makeInput({ seq: 1, flicker: true })] }, DT);
    expect(ofType(out, 'flicker')).toEqual([{ type: 'flicker', lightIds: ['L1'] }]);
    expect(out.lights[0]!.flickerUntil).toBeCloseTo(w.time + DT + CONFIG.ghost.flickerSeconds, 6);
  });

  it('살아 있는 사람의 flicker 플래그는 무시된다', () => {
    const w = ghostWorld();
    w.lights.push({ id: 'L1', floor: 0, pos: { x: 30.5, y: 20.5 }, radius: 5, on: true, flickering: false, flickerUntil: 0 });
    expect(ofType(step(w, { b: [makeInput({ seq: 1, flicker: true })] }, DT), 'flicker')).toEqual([]);
  });

  it('유령도 퀵챗을 보낼 수 있다', () => {
    const out = step(ghostWorld(), { a: [makeInput({ seq: 1, chat: 0 })] }, DT);
    expect(ofType(out, 'chat')).toHaveLength(1);
  });
});

describe('step: 상호작용', () => {
  it('트럭 구역에서 엣지: 적재한다', () => {
    const w = makeParkingWorld(['a']);
    w.items.i1 = makeItem('i1', 5, { value: 30, carriedBy: 'a' });
    w.items.i2 = makeItem('i2', 5, { value: 20, carriedBy: 'a' });
    w.players.a!.inventory = ['i1', 'i2'];
    const out = step(w, { a: [makeInput({ seq: 1, interact: true })] }, DT);
    expect(out.round.truckTotal).toBe(50);
    expect(out.items.i1!.loaded).toBe(true);
    expect(out.players.a!.inventory).toEqual([]);
    expect(out.players.a!.carriedTotal).toBe(50);
    expect(out.players.a!.prevInteract).toBe(true);
  });

  it('구역 밖에서 엣지: 가장 가까운 폐품을 줍는다. 누르고 있는 동안 다시 줍지 않는다', () => {
    const w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 20.5, y: 20.5 };
    w.items.far = makeItem('far', 5, { pos: { x: 21.5, y: 20.5 } });
    w.items.near = makeItem('near', 5, { pos: { x: 20.6, y: 20.5 } });
    const out = step(w, { a: [makeInput({ seq: 1, interact: true })] }, DT);
    expect(out.players.a!.inventory).toEqual(['near']);
    const held = step(out, { a: [makeInput({ seq: 2, interact: true })] }, DT);
    expect(held.players.a!.inventory).toEqual(['near']);
    const released = step(held, { a: [makeInput({ seq: 3, interact: false })] }, DT);
    const again = step(released, { a: [makeInput({ seq: 4, interact: true })] }, DT);
    expect(again.players.a!.inventory).toEqual(['near', 'far']);
  });

  it('트럭 구역이라도 빈손이면 주변 폐품을 줍는다', () => {
    const w = makeParkingWorld(['a']);
    w.items.i1 = makeItem('i1', 5, { pos: { x: 3.5, y: 34.9 } });
    const out = step(w, { a: [makeInput({ seq: 1, interact: true })] }, DT);
    expect(out.players.a!.inventory).toEqual(['i1']);
  });

  it('트럭 구역에서 짐이 있으면 줍지 않고 적재한다', () => {
    const w = makeParkingWorld(['a']);
    w.items.mine = makeItem('mine', 5, { value: 40, carriedBy: 'a' });
    w.items.floor = makeItem('floor', 5, { pos: { x: 3.5, y: 34.9 } });
    w.players.a!.inventory = ['mine'];
    const out = step(w, { a: [makeInput({ seq: 1, interact: true })] }, DT);
    expect(out.items.mine!.loaded).toBe(true);
    expect(out.items.floor!.carriedBy).toBeNull();
    expect(out.players.a!.inventory).toEqual([]);
  });
});

describe('step: 피해와 사망', () => {
  /** a는 (3.5, 34.5), b는 멀리 떨어진 곳. a와 겹친 추적형. */
  const contactWorld = (): World => {
    const w = makeParkingWorld(['a', 'b']);
    w.players.b!.pos = { x: 40.5, y: 20.5 };
    w.stalkers.push(makeStalker({ pos: { x: 3.5, y: 34.5 } }));
    return w;
  };

  it('추적형 접촉: 체력 1 감소, damage 이벤트, 후퇴', () => {
    const out = step(contactWorld(), {}, DT);
    expect(out.players.a!.hp).toBe(CONFIG.player.hp - 1);
    expect(ofType(out, 'damage')).toEqual([{ type: 'damage', playerId: 'a' }]);
    expect(out.stalkers[0]!.mode).toBe('retreat');
    expect(out.players.a!.alive).toBe(true);
  });

  it('후퇴 중인 추적형은 다시 피해를 주지 않는다', () => {
    let w = step(contactWorld(), {}, DT);
    w.stalkers[0]!.pos = { ...w.players.a!.pos }; // 후퇴 중이지만 겹쳐 있다고 가정
    w = step(w, {}, DT);
    expect(w.players.a!.hp).toBe(CONFIG.player.hp - 1);
    expect(ofType(w, 'damage')).toEqual([]);
  });

  it('체력 0: 사망, 손전등 꺼짐, 소지품 떨어뜨림, death 이벤트 한 번', () => {
    const w = contactWorld();
    w.players.a!.hp = 1;
    w.players.a!.flashlightOn = true;
    w.players.a!.inventory = ['i1'];
    w.items.i1 = makeItem('i1', 5, { carriedBy: 'a' });
    const out = step(w, {}, DT);
    expect(out.players.a!.alive).toBe(false);
    expect(out.players.a!.flashlightOn).toBe(false);
    expect(out.players.a!.inventory).toEqual([]);
    expect(out.items.i1!.carriedBy).toBeNull();
    expect(out.items.i1!.pos).toEqual(out.players.a!.pos);
    expect(ofType(out, 'death')).toEqual([{ type: 'death', playerId: 'a', cause: 'stalker' }]);
    expect(out.round.phase).toBe('playing'); // b가 살아 있다
    const next = step(out, {}, DT);
    expect(ofType(next, 'death')).toEqual([]);
  });

  it('시선형 접촉: 즉사(watcher)', () => {
    const w = makeParkingWorld(['a', 'b']);
    w.players.b!.pos = { x: 40.5, y: 20.5 };
    w.watcher = { ...w.watcher, active: true, floor: 0, pos: { x: 3.6, y: 34.5 } };
    const out = step(w, {}, DT);
    expect(out.players.a!.alive).toBe(false);
    expect(ofType(out, 'death')).toEqual([{ type: 'death', playerId: 'a', cause: 'watcher' }]);
  });

  it('시선형이 비춰져 얼어 있으면 닿아도 죽지 않는다', () => {
    const w = makeParkingWorld(['a', 'b']);
    w.players.b!.pos = { x: 8.5, y: 34.5 };
    w.players.b!.aim = Math.PI;
    w.players.b!.flashlightOn = true;
    w.watcher = { ...w.watcher, active: true, floor: 0, pos: { x: 3.6, y: 34.5 } };
    const out = step(w, {}, DT);
    expect(out.watcher.frozen).toBe(true);
    expect(out.players.a!.alive).toBe(true);
    expect(ofType(out, 'death')).toEqual([]);
  });

  it('마지막 생존자가 죽는 틱에는 출발보다 실패가 우선', () => {
    const w = makeParkingWorld(['a']);
    const a = w.players.a!;
    a.hp = 1;
    a.prevInteract = true;
    a.interactHeld = CONFIG.player.departHoldSeconds - 0.01; // 이번 틱에 출발이 확정될 상태
    w.round.truckTotal = 999;
    w.round.target = 250;
    w.stalkers.push(makeStalker({ pos: { x: 3.5, y: 34.5 } }));
    const out = step(w, { a: [makeInput({ seq: 1, interact: true })] }, DT);
    expect(out.players.a!.alive).toBe(false);
    expect(out.round.phase).toBe('fail');
    expect(out.round.truckTotal).toBe(0);
    expect(ofType(out, 'roundEnd')).toEqual([{ type: 'roundEnd', phase: 'fail' }]);
  });
});

describe('step: 출발과 시계', () => {
  it('전원이 트럭 구역에서 3초 누르면 출발: 총액이 목표 이상이면 성공', () => {
    let w = makeParkingWorld(['a', 'b']);
    w.round.truckTotal = 300;
    w.round.target = 250;
    const hold = { a: [makeInput({ seq: 1, interact: true })], b: [makeInput({ seq: 1, interact: true })] };
    let seq = 1;
    while (w.round.phase === 'playing' && w.tick < 100) {
      seq += 1;
      w = step(w, { a: [{ ...hold.a[0]!, seq }], b: [{ ...hold.b[0]!, seq }] }, DT);
    }
    expect(w.round.phase).toBe('success');
    // 3초(60틱). 0.05의 누적 오차로 한 틱 늦을 수 있다.
    expect(w.tick).toBeGreaterThanOrEqual(CONFIG.player.departHoldSeconds / DT);
    expect(w.tick).toBeLessThanOrEqual(CONFIG.player.departHoldSeconds / DT + 1);
    expect(ofType(w, 'roundEnd')).toEqual([{ type: 'roundEnd', phase: 'success' }]);
  });

  it('총액이 모자라면 실패', () => {
    let w = makeParkingWorld(['a']);
    w.players.a!.prevInteract = true;
    w.players.a!.interactHeld = 2.99;
    w = step(w, {}, DT);
    expect(w.round.phase).toBe('fail');
  });

  it('한 명이라도 구역 밖이면 출발 누름이 쌓이지 않는다', () => {
    let w = makeParkingWorld(['a', 'b']);
    w.players.b!.pos = { x: 30.5, y: 20.5 };
    w.players.a!.prevInteract = true;
    for (let i = 0; i < 80; i++) w = step(w, {}, DT);
    expect(w.players.a!.interactHeld).toBe(0);
    expect(w.round.phase).toBe('playing');
  });

  it('시계가 끝나면 출발: 구역 밖 생존자는 left_behind', () => {
    const w = makeParkingWorld(['a', 'b']);
    w.players.b!.pos = { x: 30.5, y: 20.5 };
    w.round.clock = CONFIG.roundEndClock - 0.001;
    w.round.watcherSpawned = true;
    w.round.lightsHalved = true;
    w.round.horned = true;
    const out = step(w, {}, DT);
    expect(out.round.clock).toBe(CONFIG.roundEndClock);
    expect(out.round.phase).toBe('fail');
    expect(out.players.b!.alive).toBe(false);
    expect(ofType(out, 'death')).toEqual([{ type: 'death', playerId: 'b', cause: 'left_behind' }]);
  });

  it('시계 이벤트: 00:30에 시선형 등장', () => {
    const w = makeParkingWorld(['a']);
    w.round.clock = CONFIG.watcherSpawnClock - 0.001;
    const out = step(w, {}, DT);
    expect(out.watcher.active).toBe(true);
    expect(out.round.watcherSpawned).toBe(true);
  });

  it('경적: 03:50에 horn 이벤트 한 번', () => {
    const w = makeParkingWorld(['a']);
    w.round.watcherSpawned = true;
    w.round.lightsHalved = true;
    w.round.clock = CONFIG.hornClock - 0.001;
    const out = step(w, {}, DT);
    expect(ofType(out, 'horn')).toHaveLength(1);
    expect(ofType(step(out, {}, DT), 'horn')).toHaveLength(0);
  });
});

describe('step: 끼임 해소', () => {
  it('벽 안에 있는 생존자와 추적형은 밖으로 옮겨진다', () => {
    const map = getMap('parking-lot');
    const w = makeParkingWorld(['a']);
    w.players.a!.pos = { x: 0.5, y: 20.5 };
    w.stalkers.push(makeStalker({ pos: { x: 0.5, y: 10.5 } }));
    expect(overlapsSolid(map, 0, w.players.a!.pos, CONFIG.player.radius)).toBe(true);
    const out = step(w, {}, DT);
    expect(overlapsSolid(map, 0, out.players.a!.pos, CONFIG.player.radius)).toBe(false);
    expect(overlapsSolid(map, 0, out.stalkers[0]!.pos, CONFIG.stalker.radius)).toBe(false);
  });

  it('활성 시선형도 해소한다', () => {
    const map = getMap('parking-lot');
    const w = makeParkingWorld(['a']);
    w.watcher = { ...w.watcher, active: true, floor: 0, pos: { x: 0.5, y: 10.5 } };
    const out = step(w, {}, DT);
    expect(overlapsSolid(map, 0, out.watcher.pos, CONFIG.watcher.radius)).toBe(false);
  });
});
