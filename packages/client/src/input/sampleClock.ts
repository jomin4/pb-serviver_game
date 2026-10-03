import { CONFIG } from '@bh/shared';

export type SampleClock = {
  /** 샘플 하나가 대표하는 시간(초) = 1 / hz. 예측도 이 dt로 적용한다. */
  readonly step: number;
  /** 프레임 간격(초)을 더하고, 이번 프레임에 만들 샘플 수를 돌려준다. */
  advance(frameDt: number): number;
  /** 다음 샘플까지 쌓인 시간의 비율 [0, 1). 직전·현재 예측 위치를 이 비율로 보간해 그린다. */
  alpha(): number;
};

/**
 * 고정 빈도 입력 샘플링용 누산기. rAF 주기(30~360Hz)와 상관없이 1초에 `hz`개의 입력을 만든다.
 * 탭 전환처럼 긴 멈춤은 `maxCatchUp`초까지만 따라잡는다(예측 dt 상한과 같은 `CONFIG.net.maxDt`).
 * 프레임당 샘플 수는 주사율에 따라 0/1/2로 들쭉날쭉하므로(60Hz에서도 간격이 조금만 흔들리면 그렇다)
 * 예측 위치를 그대로 그리면 떨린다. 그릴 때는 `alpha()`로 직전·현재 위치를 보간한다.
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
    alpha() {
      return Math.min(acc / step, 1 - Number.EPSILON);
    },
  };
}
