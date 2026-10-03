import { describe, expect, it } from 'vitest';
import type { FloorId } from '@bh/shared';
import { gainAndPan } from '../src/audio/spatial.ts';

const at = (x: number, y: number, floor: FloorId) => ({ pos: { x, y }, floor });

describe('gainAndPan', () => {
  it('다른 층 소리는 0', () => {
    expect(gainAndPan(at(0, 0, 0), at(1, 1, 1), 10).gain).toBe(0);
  });

  it('거리에 따라 선형 감쇠, 오른쪽은 +pan', () => {
    const r = gainAndPan(at(0, 0, 0), at(5, 0, 0), 10);
    expect(r.gain).toBeCloseTo(0.5);
    expect(r.pan).toBeCloseTo(0.5);
  });

  it('왼쪽은 -pan, 위아래는 pan 0', () => {
    expect(gainAndPan(at(0, 0, 0), at(-4, 0, 0), 10).pan).toBeCloseTo(-0.4);
    expect(gainAndPan(at(0, 0, 0), at(0, 3, 0), 10).pan).toBeCloseTo(0);
  });

  it('거리 0이면 gain 1, maxDistance 이상이면 0', () => {
    expect(gainAndPan(at(2, 2, 1), at(2, 2, 1), 10).gain).toBe(1);
    expect(gainAndPan(at(0, 0, 0), at(10, 0, 0), 10).gain).toBe(0);
    expect(gainAndPan(at(0, 0, 0), at(30, 40, 0), 10).gain).toBe(0);
  });

  it('pan은 -1~1로 자른다', () => {
    expect(gainAndPan(at(0, 0, 0), at(50, 0, 0), 10).pan).toBe(1);
    expect(gainAndPan(at(0, 0, 0), at(-50, 0, 0), 10).pan).toBe(-1);
  });

  it('maxDistance가 0 이하여도 NaN을 내지 않는다', () => {
    const r = gainAndPan(at(0, 0, 0), at(1, 0, 0), 0);
    expect(r.gain).toBe(0);
    expect(Number.isNaN(r.pan)).toBe(false);
  });
});
