import { describe, expect, it } from 'vitest';
import { formatClock } from '../src/ui/hud.ts';

describe('formatClock', () => {
  it.each([
    [0, '00:00'],
    [0.9, '00:00'],
    [30, '00:30'],
    [61.5, '01:01'],
    [230, '03:50'],
    [240, '04:00'],
    [-5, '00:00'],
    [999, '04:00'],
  ])('%s분 → %s', (clock, text) => {
    expect(formatClock(clock)).toBe(text);
  });
});
