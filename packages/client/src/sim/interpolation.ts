import { angleDiff, CONFIG } from '@bh/shared';
import type { FloorId, Vec } from '@bh/shared';

/** `aim`(라디안)은 조준 방향이 있는 엔티티(플레이어)만 넣는다. */
export type EntityPose = { pos: Vec; floor: FloorId; aim?: number };
export type Snapshot = Record<string, EntityPose>;

export type Interpolator = {
  push(timeMs: number, snapshot: Snapshot): void;
  sample(nowMs: number): Snapshot;
};

/** 이 간격(ms) 이상 벌어진 두 스냅숏은 보간하지 않는다(탭이 백그라운드였다가 돌아온 경우, 스펙 5.2). */
const MAX_GAP_MS = 1000;

type Entry = { t: number; snap: Snapshot };

const copy = (e: EntityPose): EntityPose =>
  e.aim === undefined ? { pos: { x: e.pos.x, y: e.pos.y }, floor: e.floor } : { pos: { x: e.pos.x, y: e.pos.y }, floor: e.floor, aim: e.aim };

/** 각도 a → b를 짧은 호로 k만큼 보간한다. 결과는 (−π, π]. */
function lerpAngle(a: number, b: number, k: number): number {
  const r = angleDiff(a + angleDiff(b, a) * k, 0); // [−π, π)
  return r === -Math.PI ? Math.PI : r;
}

function lerpPose(prev: EntityPose, next: EntityPose, k: number): EntityPose {
  const pos = { x: prev.pos.x + (next.pos.x - prev.pos.x) * k, y: prev.pos.y + (next.pos.y - prev.pos.y) * k };
  if (next.aim === undefined) return { pos, floor: next.floor };
  return { pos, floor: next.floor, aim: prev.aim === undefined ? next.aim : lerpAngle(prev.aim, next.aim, k) };
}
const copyAll = (s: Snapshot): Snapshot => Object.fromEntries(Object.entries(s).map(([id, e]) => [id, copy(e)]));

/**
 * 다른 엔티티를 `delayMs`만큼 늦춰 그리기 위한 스냅숏 보간기(스펙 3.3).
 * `sample(nowMs)`는 렌더 시각 `nowMs - delayMs`를 감싸는 두 스냅숏 사이를 엔티티별로 선형 보간한다(조준 `aim`은 짧은 호로).
 * 층이 바뀐 엔티티, 이전 스냅숏에 없던 엔티티, 두 스냅숏이 `MAX_GAP_MS` 이상 벌어진 경우에는 보간하지 않고
 * 더 새로운 쪽 값을 쓴다. 렌더 시각이 가장 최신 스냅숏보다 뒤이면 외삽하지 않고 최신 값을 쓴다.
 * 새 스냅숏이 직전 것보다 `MAX_GAP_MS` 이상 늦으면 이전 기록을 버려 즉시 최신 상태로 맞춘다.
 * 시간 단위는 호출자가 정한 ms이고(예: `performance.now()`), 같은 시계를 `push`와 `sample`에 써야 한다.
 */
export function createInterpolator(delayMs: number = CONFIG.net.interpolationMs): Interpolator {
  let buf: Entry[] = [];

  return {
    push(timeMs, snapshot) {
      const last = buf[buf.length - 1];
      if (last && timeMs <= last.t) return; // 순서가 뒤바뀐 것은 무시한다
      if (last && timeMs - last.t >= MAX_GAP_MS) buf = [];
      buf.push({ t: timeMs, snap: copyAll(snapshot) });
      // 렌더 시각 이전 것은 하나만 남기면 된다. 여유로 지연 + 최대 간격만큼 보관한다.
      const oldestUseful = timeMs - delayMs - MAX_GAP_MS;
      while (buf.length > 2 && buf[1]!.t < oldestUseful) buf.shift();
    },
    sample(nowMs) {
      if (buf.length === 0) return {};
      const target = nowMs - delayMs;
      const first = buf[0]!;
      const last = buf[buf.length - 1]!;
      if (target <= first.t) return copyAll(first.snap);
      if (target >= last.t) return copyAll(last.snap);
      let i = 1;
      while (buf[i]!.t <= target) i++;
      const a = buf[i - 1]!;
      const b = buf[i]!;
      const k = (target - a.t) / (b.t - a.t);
      const smooth = b.t - a.t < MAX_GAP_MS;
      const out: Snapshot = {};
      for (const [id, next] of Object.entries(b.snap)) {
        const prev = a.snap[id];
        out[id] = smooth && prev && prev.floor === next.floor ? lerpPose(prev, next, k) : copy(next);
      }
      return out;
    },
  };
}
