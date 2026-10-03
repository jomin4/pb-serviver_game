import { describe, expect, it } from 'vitest';
import { CONFIG } from '@bh/shared';
import { createSampleClock } from '../src/input/sampleClock.ts';

/** 프레임 간격(초) 목록을 흘려 보내 샘플 수를 센다. */
const totalSamples = (hz: number, frameDt: number, frames: number): number => {
  const clock = createSampleClock(hz);
  let n = 0;
  for (let i = 0; i < frames; i++) n += clock.advance(frameDt);
  return n;
};

describe('createSampleClock', () => {
  it('기본 빈도는 CONFIG.net.inputSampleHz이고 step은 1/hz', () => {
    expect(CONFIG.net.inputSampleHz).toBe(60);
    expect(createSampleClock().step).toBeCloseTo(1 / 60, 12);
  });

  it('주사율과 상관없이 1초에 약 60개를 샘플링한다', () => {
    for (const fps of [30, 60, 75, 120, 144, 165, 240, 360]) {
      const n = totalSamples(60, 1 / fps, fps * 10); // 10초
      expect(Math.abs(n - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('240Hz에서는 프레임 대부분이 샘플을 만들지 않는다(서버 틱당 입력 수가 한도 아래로 유지된다)', () => {
    const clock = createSampleClock(60);
    const perFrame = Array.from({ length: 240 }, () => clock.advance(1 / 240));
    expect(Math.max(...perFrame)).toBe(1);
    // 서버 틱(50ms)당 입력 수
    expect(60 * CONFIG.tickMs / 1000).toBeLessThanOrEqual(CONFIG.net.maxInputsPerBatch);
  });

  it('30Hz 프레임이면 한 프레임에 두 개를 샘플링한다', () => {
    const clock = createSampleClock(60);
    clock.advance(1 / 30);
    expect(clock.advance(1 / 30)).toBe(2);
  });

  it('긴 멈춤(탭 전환 등)은 maxDt까지만 따라잡는다', () => {
    const clock = createSampleClock(60);
    expect(clock.advance(5)).toBe(Math.floor(CONFIG.net.maxDt * 60 + 1e-9));
    expect(clock.advance(1 / 240)).toBe(0); // 남은 몫이 한 step을 넘지 않는다
  });

  it('음수·NaN 간격은 무시한다', () => {
    const clock = createSampleClock(60);
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.advance(1 / 60)).toBe(1);
  });

  it('alpha는 다음 샘플까지 쌓인 시간의 비율(0 이상 1 미만)', () => {
    const clock = createSampleClock(60);
    expect(clock.alpha()).toBe(0);
    clock.advance(1 / 120);
    expect(clock.alpha()).toBeCloseTo(0.5, 9);
    clock.advance(1 / 60); // 1.5 step → 샘플 1개, 0.5 남음
    expect(clock.alpha()).toBeCloseTo(0.5, 9);
    clock.advance(5); // 긴 멈춤 뒤에도 1 미만
    expect(clock.alpha()).toBeGreaterThanOrEqual(0);
    expect(clock.alpha()).toBeLessThan(1);
  });

  it('60Hz 프레임 간격이 흔들려도 (샘플 수 + alpha)는 프레임마다 frameDt/step만큼 고르게 늘어난다', () => {
    // 실제 60Hz rAF 간격은 16.67ms 근처에서 조금씩 흔들린다. 샘플 수만 보면 0/1/2로 튀지만
    // 그리는 위치는 (샘플 수 + alpha) 기준으로 보간하므로 프레임마다 거의 1 step씩 고르게 나아가야 한다.
    const clock = createSampleClock(60);
    const jitter = [0.3, -0.2, 0.1, -0.3, 0.25, -0.05, 0.15, -0.25];
    let prevAlpha = clock.alpha();
    for (let i = 0; i < 600; i++) {
      const dt = (1000 / 60 + jitter[i % jitter.length]!) / 1000;
      const n = clock.advance(dt);
      const alpha = clock.alpha();
      expect(n + alpha - prevAlpha).toBeCloseTo(dt * 60, 6);
      prevAlpha = alpha;
    }
  });
});

