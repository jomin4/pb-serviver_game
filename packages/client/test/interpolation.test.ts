import { describe, expect, it } from 'vitest';
import { createInterpolator } from '../src/sim/interpolation.ts';

type Snap = Record<string, { pos: { x: number; y: number }; floor: 0 | 1 }>;
const at = (x: number, y = 0, floor: 0 | 1 = 0) => ({ pos: { x, y }, floor });

describe('interpolator', () => {
  it('보간은 100ms 전 두 스냅숏 사이 값', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0, 0) });
    ip.push(1050, { a: at(10, 4) });
    ip.push(1100, { a: at(20, 8) });
    // now 1175 → 렌더 시각 1075: 1050과 1100 사이 절반
    const s = ip.sample(1175);
    expect(s.a!.pos.x).toBeCloseTo(15);
    expect(s.a!.pos.y).toBeCloseTo(6);
    expect(s.a!.floor).toBe(0);
  });
  it('기본 지연은 CONFIG의 100ms', () => {
    const ip = createInterpolator();
    ip.push(0, { a: at(0) });
    ip.push(100, { a: at(10) });
    expect(ip.sample(150).a!.pos.x).toBeCloseTo(5);
  });
  it('층이 바뀌면 보간하지 않는다', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0, 0, 0) });
    ip.push(1100, { a: at(30, 0, 1) });
    const s = ip.sample(1150); // 렌더 시각 1050, 둘 사이
    expect(s.a).toEqual(at(30, 0, 1));
  });
  it('1초 이상 간격이면 최신 값으로 즉시 이동', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0) });
    ip.push(2500, { a: at(40) });
    expect(ip.sample(2550).a!.pos.x).toBe(40);
    expect(ip.sample(1700).a!.pos.x).toBe(40);
  });
  it('1초 미만 간격은 정상 보간', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0) });
    ip.push(1900, { a: at(9) });
    expect(ip.sample(1550).a!.pos.x).toBeCloseTo(4.5);
  });
  it('스냅숏이 하나뿐이면 그 값', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(3, 2) });
    expect(ip.sample(5000).a).toEqual(at(3, 2));
    expect(ip.sample(0).a).toEqual(at(3, 2));
  });
  it('스냅숏이 없으면 빈 객체', () => {
    expect(createInterpolator(100).sample(1000)).toEqual({});
  });
  it('렌더 시각이 가장 최신보다 뒤면 외삽하지 않고 최신 값', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0) });
    ip.push(1050, { a: at(10) });
    expect(ip.sample(1500).a!.pos.x).toBe(10);
  });
  it('렌더 시각이 가장 오래된 것보다 앞이면 가장 오래된 값', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0) });
    ip.push(1050, { a: at(10) });
    expect(ip.sample(1000).a!.pos.x).toBe(0);
  });
  it('새로 나타난 엔티티는 보간 없이 그 값, 사라진 엔티티는 나오지 않는다', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0), gone: at(5) });
    ip.push(1100, { a: at(10), fresh: at(7) });
    const s = ip.sample(1150);
    expect(s.fresh).toEqual(at(7));
    expect(s.a!.pos.x).toBeCloseTo(5);
    expect(s.gone).toBeUndefined();
  });
  it('엔티티별로 따로 보간한다', () => {
    const ip = createInterpolator(100);
    ip.push(0, { a: at(0), b: at(100) });
    ip.push(100, { a: at(10), b: at(80) });
    const s = ip.sample(150);
    expect(s.a!.pos.x).toBeCloseTo(5);
    expect(s.b!.pos.x).toBeCloseTo(90);
  });
  it('받은 객체를 변경하지 않고 결과도 내부 상태와 분리된다', () => {
    const ip = createInterpolator(100);
    const first: Snap = { a: at(0) };
    ip.push(0, first);
    ip.push(100, { a: at(10) });
    const out = ip.sample(150);
    out.a!.pos.x = 999;
    expect(ip.sample(150).a!.pos.x).toBeCloseTo(5);
    expect(first.a!.pos.x).toBe(0);
  });
  it('오래된 스냅숏은 정리되어도 결과가 같다', () => {
    const ip = createInterpolator(100);
    for (let i = 0; i <= 200; i++) ip.push(i * 50, { a: at(i) });
    // now = 10000+100-25 → 렌더 시각 9975 = 199.5번째
    expect(ip.sample(10075).a!.pos.x).toBeCloseTo(199.5);
  });
  it('순서가 뒤바뀐(더 오래된) 스냅숏은 무시한다', () => {
    const ip = createInterpolator(100);
    ip.push(1000, { a: at(0) });
    ip.push(1100, { a: at(10) });
    ip.push(1050, { a: at(999) });
    expect(ip.sample(1150).a!.pos.x).toBeCloseTo(5);
  });
});
