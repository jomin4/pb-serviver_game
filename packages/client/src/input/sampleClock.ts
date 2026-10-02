import { CONFIG } from '@bh/shared';

export type SampleClock = {
  /** 샘플 하나가 대표하는 시간(초) = 1 / hz. 예측도 이 dt로 적용한다. */
  readonly step: number;
  /** 프레임 간격(초)을 더하고, 이번 프레임에 만들 샘플 수를 돌려준다. */
  advance(frameDt: number): number;
};

/**
 * 고정 빈도 입력 샘플링용 누산기. rAF 주기(30~360Hz)와 상관없이 1초에 `hz`개의 입력을 만든다.
 * 탭 전환처럼 긴 멈춤은 `maxCatchUp`초까지만 따라잡는다(예측 dt 상한과 같은 `CONFIG.net.maxDt`).
 */
export function createSampleClock(hz: number = CONFIG.net.inputSampleHz, maxCatchUp: number = CONFIG.net.maxDt): SampleClock {
  const step = 1 / hz;
  let acc = 0;
  return {
    step,
    advance(frameDt) {
      if (!(frameDt > 0)) return 0;
      acc = Math.min(acc + frameDt, maxCatchUp);
      // 1e-9: 부동소수 오차로 정확히 한 step이 모자라 보이는 경우를 막는다
      const n = Math.floor(acc / step + 1e-9);
      acc = Math.max(0, acc - n * step);
      return n;
    },
  };
}
