import { CONFIG } from '@bh/shared';
import type { PlayerInput } from '@bh/shared';

export type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type Sender = {
  push(input: PlayerInput): void;
  /** 쌓인 입력을 지금 보낸다. 비어 있으면 아무것도 하지 않는다. */
  flush(): void;
  start(): void;
  stop(): void;
};

/** 한 번 눌린 순간에만 의미 있는 입력(엣지)을 담고 있는가. 잃으면 동작이 사라진다. */
function hasEdge(i: PlayerInput): boolean {
  return i.toggleFlashlight || i.drop || i.flicker || i.selectSlot !== null || i.ping !== null || i.chat !== null;
}

/**
 * 서버 한도(`CONFIG.net.maxInputsPerBatch`)를 넘으면 엣지가 있는 입력을 우선(최근 것부터),
 * 남는 자리는 가장 최근 입력으로 채운다. 결과는 seq 순서를 유지한다.
 * (탭이 멈췄다 돌아오는 등 아주 긴 정지 뒤에만 일어난다. 버려진 이동 입력은 서버가 보지 못하므로
 * 예측과 어긋난 만큼은 다음 `reconcile`에서 보정된다.)
 */
export function capBatch(inputs: PlayerInput[], max = CONFIG.net.maxInputsPerBatch): PlayerInput[] {
  if (inputs.length <= max) return inputs;
  const newestFirst = inputs.map((_, i) => i).reverse();
  const keep = [...newestFirst.filter((i) => hasEdge(inputs[i]!)), ...newestFirst.filter((i) => !hasEdge(inputs[i]!))].slice(0, max);
  return keep.sort((a, b) => a - b).map((i) => inputs[i]!);
}

const defaultTimers = (): Timers => ({
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
});

/** `intervalMs`마다 쌓인 입력을 한 번에 보낸다. 빈 배치는 보내지 않는다. */
export function createSender(
  send: (batch: PlayerInput[]) => void,
  intervalMs: number = CONFIG.inputSendMs,
  timers?: Timers,
): Sender {
  let buffer: PlayerInput[] = [];
  let handle: unknown = null;
  let running = false;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const batch = capBatch(buffer);
    buffer = [];
    send(batch);
  };

  return {
    push(input) { buffer.push(input); },
    flush,
    start() {
      if (running) return;
      running = true;
      const t = timers ?? defaultTimers();
      handle = t.setInterval(flush, intervalMs);
    },
    stop() {
      if (!running) return;
      running = false;
      (timers ?? defaultTimers()).clearInterval(handle);
      handle = null;
    },
  };
}
