import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';

describe('CONFIG', () => {
  it('인원별 난이도가 스펙 2.5와 일치', () => {
    expect(CONFIG.difficulty[1]).toEqual({ target: 150, stalkers: 1, stalkerSpeedMul: 0.85 });
    expect(CONFIG.difficulty[4]).toEqual({ target: 450, stalkers: 2, stalkerSpeedMul: 1 });
  });
  it('라운드 길이는 실제 12분', () => {
    expect(CONFIG.roundEndClock * CONFIG.realSecondsPerGameMinute).toBe(720);
  });
});
