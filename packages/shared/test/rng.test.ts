import { describe, expect, it } from 'vitest';
import { createRng, rngFromState } from '../src/rng.ts';

describe('rng', () => {
  it('같은 시드는 같은 수열', () => {
    const a = createRng(42), b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('next는 [0,1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('int는 양끝 포함', () => {
    const r = createRng(7);
    const s = new Set<number>();
    for (let i = 0; i < 2000; i++) s.add(r.int(1, 3));
    expect([...s].sort()).toEqual([1, 2, 3]);
  });
  it('state로 이어서 생성', () => {
    const a = createRng(9);
    a.next();
    const b = rngFromState(a.state());
    expect(b.next()).toBe(a.next());
  });
});
