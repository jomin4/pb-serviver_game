import type { FloorId, Vec } from '@bh/shared';

export type Pose = { pos: Vec; floor: FloorId };

/** 직전·현재 예측 위치가 이 거리(칸)보다 멀면 순간이동(보정·부활 등)으로 보고 보간하지 않는다. */
export const MAX_BLEND_DIST = 1;

/**
 * 고정 dt로 예측한 내 캐릭터를 rAF 프레임 사이에 부드럽게 그리기 위한 보간.
 * `alpha`는 `SampleClock.alpha()`(다음 샘플까지 쌓인 시간의 비율)이고, 그리는 위치는 최신 예측보다
 * 최대 한 샘플(1/60초) 늦다. 층이 바뀌었거나 `MAX_BLEND_DIST`보다 멀리 움직였으면 현재 값을 그대로 쓴다.
 */
export function blendPose(prev: Pose, cur: Pose, alpha: number): Pose {
  const k = Math.max(0, Math.min(1, alpha));
  const dx = cur.pos.x - prev.pos.x;
  const dy = cur.pos.y - prev.pos.y;
  if (prev.floor !== cur.floor || dx * dx + dy * dy > MAX_BLEND_DIST * MAX_BLEND_DIST) {
    return { pos: { x: cur.pos.x, y: cur.pos.y }, floor: cur.floor };
  }
  return { pos: { x: prev.pos.x + dx * k, y: prev.pos.y + dy * k }, floor: cur.floor };
}
