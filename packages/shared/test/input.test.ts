import { describe, expect, it } from 'vitest';
import { len } from '../src/geometry.ts';
import { EMPTY_INPUT, sanitizeBatch, sanitizeInput } from '../src/input.ts';
import type { PlayerInput } from '../src/types.ts';

const ok: PlayerInput = {
  seq: 1, move: { x: 0, y: 0 }, run: false, aim: 0, toggleFlashlight: false,
  interact: false, drop: false, selectSlot: null, ping: null, chat: null, flicker: false,
};

describe('sanitizeInput', () => {
  it('문자열·null은 거부', () => { expect(sanitizeInput('x')).toBeNull(); expect(sanitizeInput(null)).toBeNull(); });
  it('배열·숫자·undefined도 거부', () => {
    expect(sanitizeInput([])).toBeNull(); expect(sanitizeInput(5)).toBeNull(); expect(sanitizeInput(undefined)).toBeNull();
  });
  it('유효한 입력은 그대로 통과', () => { expect(sanitizeInput(ok)).toEqual(ok); });
  it('seq가 음수/소수면 거부', () => { expect(sanitizeInput({...ok, seq:-1})).toBeNull(); expect(sanitizeInput({...ok, seq:1.5})).toBeNull(); });
  it('seq가 NaN/Infinity/비숫자/누락/안전하지 않은 정수면 거부', () => {
    for (const seq of [NaN, Infinity, '1', null, undefined, Number.MAX_SAFE_INTEGER + 2, 1e300]) {
      expect(sanitizeInput({ ...ok, seq })).toBeNull();
    }
    const { seq: _seq, ...noSeq } = ok;
    expect(sanitizeInput(noSeq)).toBeNull();
  });
  it('seq 0은 허용', () => { expect(sanitizeInput({...ok, seq:0})!.seq).toBe(0); });
  it('move 길이를 1로 제한', () => { expect(len(sanitizeInput({...ok, move:{x:10,y:0}})!.move)).toBeCloseTo(1); });
  it('길이 ≤ 1인 move는 유지', () => { expect(sanitizeInput({...ok, move:{x:0.3,y:-0.4}})!.move).toEqual({x:0.3,y:-0.4}); });
  it('오버플로 크기의 move도 길이 1로 제한', () => {
    const m = sanitizeInput({...ok, move:{x:1e308,y:1e308}})!.move;
    expect(len(m)).toBeCloseTo(1); expect(m.x).toBeGreaterThan(0);
  });
  it('NaN 이동은 0', () => { expect(sanitizeInput({...ok, move:{x:NaN,y:1}})!.move).toEqual({x:0,y:1}); });
  it('Infinity·비숫자·누락 이동 성분은 0', () => {
    expect(sanitizeInput({...ok, move:{x:Infinity,y:'a'}})!.move).toEqual({x:0,y:0});
    expect(sanitizeInput({...ok, move:null})!.move).toEqual({x:0,y:0});
    expect(sanitizeInput({...ok, move:{x:1}})!.move).toEqual({x:1,y:0});
  });
  it('aim은 (−π, π]로 감싼다', () => {
    expect(sanitizeInput({...ok, aim: 2 * Math.PI + 0.5})!.aim).toBeCloseTo(0.5);
    expect(sanitizeInput({...ok, aim: -2 * Math.PI - 0.5})!.aim).toBeCloseTo(-0.5);
    expect(sanitizeInput({...ok, aim: Math.PI})!.aim).toBeCloseTo(Math.PI);
    expect(sanitizeInput({...ok, aim: -Math.PI})!.aim).toBeCloseTo(Math.PI);
    const huge = sanitizeInput({...ok, aim: 1e300})!.aim;
    expect(huge).toBeGreaterThan(-Math.PI); expect(huge).toBeLessThanOrEqual(Math.PI);
  });
  it('aim NaN/Infinity/비숫자는 0', () => {
    for (const aim of [NaN, Infinity, -Infinity, 'x', null, undefined]) expect(sanitizeInput({...ok, aim})!.aim).toBe(0);
  });
  it('boolean이 아닌 플래그는 false', () => {
    const i = sanitizeInput({...ok, run: 1, toggleFlashlight: 'true', interact: {}, drop: [], flicker: 'yes'})!;
    expect([i.run, i.toggleFlashlight, i.interact, i.drop, i.flicker]).toEqual([false, false, false, false, false]);
  });
  it('true 플래그는 유지', () => {
    const i = sanitizeInput({...ok, run: true, toggleFlashlight: true, interact: true, drop: true, flicker: true})!;
    expect([i.run, i.toggleFlashlight, i.interact, i.drop, i.flicker]).toEqual([true, true, true, true, true]);
  });
  it('잘못된 chat/slot은 null', () => { const i = sanitizeInput({...ok, chat:9, selectSlot:5})!; expect(i.chat).toBeNull(); expect(i.selectSlot).toBeNull(); });
  it('selectSlot은 0|1|2, chat은 0..5 정수만', () => {
    for (const s of [0, 1, 2]) expect(sanitizeInput({...ok, selectSlot: s})!.selectSlot).toBe(s);
    for (const c of [0, 1, 2, 3, 4, 5]) expect(sanitizeInput({...ok, chat: c})!.chat).toBe(c);
    for (const v of [-1, 3, 1.5, NaN, '1', true]) expect(sanitizeInput({...ok, selectSlot: v})!.selectSlot).toBeNull();
    for (const v of [-1, 6, 1.5, NaN, '1', false]) expect(sanitizeInput({...ok, chat: v})!.chat).toBeNull();
  });
  it('ping은 유한 좌표만 허용', () => {
    expect(sanitizeInput({...ok, ping:{x:3,y:4.5}})!.ping).toEqual({x:3,y:4.5});
    for (const p of [{x:NaN,y:1}, {x:1,y:Infinity}, {x:'1',y:1}, {x:1}, 'p', 5, []]) {
      expect(sanitizeInput({...ok, ping: p})!.ping).toBeNull();
    }
  });
  it('누락된 선택 필드는 EMPTY_INPUT 기본값', () => {
    expect(sanitizeInput({ seq: 7 })).toEqual(EMPTY_INPUT(7));
  });
  it('알 수 없는 필드는 무시', () => {
    const out = sanitizeInput({...ok, hack: 1, __proto__: { x: 1 }, extra: { a: 1 }})!;
    expect(out).toEqual(ok);
    expect(Object.keys(out).sort()).toEqual(Object.keys(ok).sort());
  });
  it('결과는 입력 객체와 참조를 공유하지 않는다', () => {
    const raw = {...ok, move: {x:0.5,y:0}, ping: {x:1,y:2}};
    const out = sanitizeInput(raw)!;
    expect(out.move).not.toBe(raw.move); expect(out.ping).not.toBe(raw.ping);
  });
});

describe('EMPTY_INPUT', () => {
  it('주어진 seq의 빈 입력', () => { expect(EMPTY_INPUT(3)).toEqual({...ok, seq: 3}); });
  it('호출마다 새 객체', () => { expect(EMPTY_INPUT(1).move).not.toBe(EMPTY_INPUT(1).move); });
});

describe('sanitizeBatch', () => {
  it('배치는 최대 10개', () => { expect(sanitizeBatch(Array(50).fill(ok))).toHaveLength(10); });
  it('배열이 아니면 []', () => {
    for (const v of [null, undefined, 'x', 5, {}, { length: 3 }]) expect(sanitizeBatch(v)).toEqual([]);
  });
  it('유효하지 않은 항목은 걸러낸다', () => {
    const out = sanitizeBatch([ok, 'bad', {...ok, seq: -1}, {...ok, seq: 2}, null]);
    expect(out.map((i) => i.seq)).toEqual([1, 2]);
  });
  it('앞의 10개만 보고 그중 유효한 것만 남긴다', () => {
    const raw = [...Array(9).fill('bad'), {...ok, seq: 10}, {...ok, seq: 11}];
    expect(sanitizeBatch(raw).map((i) => i.seq)).toEqual([10]);
  });
});
