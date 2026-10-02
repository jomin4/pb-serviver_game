import type { FloorId, Vec, World } from './types.ts';

/**
 * 소음을 낸다. 이번 틱의 `events`에 `noise` 이벤트를 추가할 뿐이며, 듣는 쪽(추적형 등)이 같은 틱에 읽는다.
 * 위치는 복사해 두므로 호출 뒤 `pos`를 바꿔도 이벤트는 변하지 않는다.
 */
export function emitNoise(world: World, floor: FloorId, pos: Vec, radius: number): void {
  world.events.push({ type: 'noise', floor, pos: { x: pos.x, y: pos.y }, radius });
}
