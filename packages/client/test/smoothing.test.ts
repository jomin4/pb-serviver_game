import { describe, expect, it } from 'vitest';
import { createSampleClock } from '../src/input/sampleClock.ts';
import { blendPose, MAX_BLEND_DIST } from '../src/sim/smoothing.ts';

const at = (x: number, y = 0, floor: 0 | 1 = 0) => ({ pos: { x, y }, floor });

describe('blendPose', () => {
  it('alpha 0이면 이전, 1이면 현재, 그 사이는 선형 보간', () => {
    expect(blendPose(at(0, 0), at(0.1, 0.2), 0)).toEqual(at(0, 0));
    expect(blendPose(at(0, 0), at(0.1, 0.2), 1)).toEqual(at(0.1, 0.2));
    const mid = blendPose(at(0, 0), at(0.1, 0.2), 0.5);
    expect(mid.pos.x).toBeCloseTo(0.05, 12);
    expect(mid.pos.y).toBeCloseTo(0.1, 12);
    expect(mid.floor).toBe(0);
  });

  it('alpha는 0~1로 제한한다', () => {
    expect(blendPose(at(0), at(0.1), -1)).toEqual(at(0));
    expect(blendPose(at(0), at(0.1), 2)).toEqual(at(0.1));
  });

  it('층이 바뀌면 보간하지 않고 현재 값을 쓴다', () => {
    expect(blendPose(at(0, 0, 0), at(0.1, 0, 1), 0.5)).toEqual(at(0.1, 0, 1));
  });

  it(`MAX_BLEND_DIST(${MAX_BLEND_DIST}칸)보다 멀리 움직였으면 순간이동으로 보고 현재 값을 쓴다`, () => {
    expect(blendPose(at(0), at(MAX_BLEND_DIST + 0.01), 0.5)).toEqual(at(MAX_BLEND_DIST + 0.01));
  });

  it('돌려준 값은 입력과 객체를 공유하지 않는다', () => {
    const cur = at(1);
    const out = blendPose(cur, cur, 1);
    expect(out).not.toBe(cur);
    expect(out.pos).not.toBe(cur.pos);
  });

  it('60Hz 프레임 간격이 흔들려도 그리는 위치는 프레임마다 고르게 나아간다(떨림 회귀)', () => {
    // game.ts와 같은 방식: 샘플마다 고정 step으로 이동하고, 그릴 때는 직전·현재 위치를 alpha로 보간한다.
    const speed = 5; // 칸/초(달리기)
    const clock = createSampleClock(60);
    const jitter = [0.3, -0.2, 0.1, -0.3, 0.25, -0.05, 0.15, -0.25];
    let prev = at(0);
    let cur = at(0);
    let shownX = blendPose(prev, cur, clock.alpha()).pos.x;
    for (let i = 0; i < 600; i++) {
      const dt = (1000 / 60 + jitter[i % jitter.length]!) / 1000;
      const n = clock.advance(dt);
      for (let k = 0; k < n; k++) {
        prev = cur;
        cur = at(cur.pos.x + speed * clock.step);
      }
      const x = blendPose(prev, cur, clock.alpha()).pos.x;
      // 샘플 수(0/1/2)와 상관없이 실제 경과 시간만큼 움직여 보여야 한다.
      // 첫 프레임은 정지 상태(prev === cur)에서 출발하므로 제외한다.
      if (i > 0) expect(x - shownX).toBeCloseTo(speed * dt, 9);
      shownX = x;
    }
  });
});
