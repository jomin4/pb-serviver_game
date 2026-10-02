import type { FloorId, Vec } from '../../src/types.ts';
import type { MapData } from '../../src/map/types.ts';

/** 맵을 깊은 복사한다. 테스트가 원본 맵 데이터를 오염시키지 않도록 쓴다. */
export function cloneMap(map: MapData): MapData {
  return JSON.parse(JSON.stringify(map)) as MapData;
}

/**
 * 길찾기·AI 테스트용 작은 맵(10×6, 두 층). 모든 좌표는 (tx, ty) 타일.
 *
 * B1(층 0)               B2(층 1)
 *   ##########             ##########
 *   #........#             #......S.#   B2 계단 (7,1)
 *   #....#...#   (5,2)     #........#
 *   #....#...#   중간 벽    #........#
 *   #.S..#...#   x=5, y=2..4  #........#
 *   ##########             ##########
 *      B1 계단 (2,4)
 *
 * - 중간 벽은 위쪽(y=1)만 열려 있어 좌↔우 이동은 (5,1)을 거쳐 돌아간다.
 * - 벽 끝 (5,2)가 모서리다: (4,2)→(5,1) 대각선은 옆 칸 (5,2)가 벽이라 막힌다.
 * - (9,0)은 벽이다.
 */
export const tinyMap: MapData = {
  id: 'tiny',
  floors: [
    { width: 10, height: 6, rows: ['##########', '#........#', '#....#...#', '#....#...#', '#.S..#...#', '##########'] },
    { width: 10, height: 6, rows: ['##########', '#......S.#', '#........#', '#........#', '#........#', '##########'] },
  ],
  truckZone: { x: 1, y: 1, w: 3, h: 2 },
  spawns: [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 1.5, y: 2.5 }, { x: 2.5, y: 2.5 }],
  itemSlots: [{ floor: 0, pos: { x: 7.5, y: 3.5 } }, { floor: 1, pos: { x: 3.5, y: 3.5 } }],
  patrolRoutes: [
    { floor: 0, points: [{ x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 }] },
    { floor: 1, points: [{ x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 }] },
  ],
  lights: [],
  stairs: [{ a: { floor: 0, tile: { x: 2, y: 4 } }, b: { floor: 1, tile: { x: 7, y: 1 } } }],
  zones: [],
};

/** 타일 (tx, ty)의 중심 위치. */
export const at = (floor: FloorId, tx: number, ty: number): { floor: FloorId; pos: Vec } => ({
  floor,
  pos: { x: tx + 0.5, y: ty + 0.5 },
});
