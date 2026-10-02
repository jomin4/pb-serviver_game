import type { FloorId, Vec } from '@bh/shared';

export type Located = { pos: Vec; floor: FloorId };

/**
 * 듣는 이와 소리 근원의 위치로 음량(0~1)과 좌우 패닝(-1~1)을 구한다(스펙 4.4).
 * 다른 층이면 0, 거리 0이면 1, `maxDistance` 이상이면 0까지 선형으로 줄어든다.
 * 패닝은 가로 거리 / `maxDistance`(오른쪽 +)이고 -1~1로 자른다.
 */
export function gainAndPan(listener: Located, source: Located, maxDistance: number): { gain: number; pan: number } {
  if (listener.floor !== source.floor || !(maxDistance > 0)) return { gain: 0, pan: 0 };
  const dx = source.pos.x - listener.pos.x;
  const dy = source.pos.y - listener.pos.y;
  const gain = Math.min(1, Math.max(0, 1 - Math.hypot(dx, dy) / maxDistance));
  const pan = Math.min(1, Math.max(-1, dx / maxDistance));
  return { gain, pan };
}
