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

const ring = (w: number, h: number): string[] =>
  Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? '#'.repeat(w) : `#${'.'.repeat(w - 2)}#`));

const noStairs = { stairs: [] as MapData['stairs'] };

/**
 * 시야 테스트용 20×20 열린 방(두 층). 가장자리만 벽이다. 반경 8 안에 벽이 없는 지점이 많아
 * 사거리·가시 다각형이 원에 가까워지는지 확인하기 좋다.
 */
export const open20: MapData = {
  id: 'open20',
  floors: [
    { width: 20, height: 20, rows: ring(20, 20) },
    { width: 20, height: 20, rows: ring(20, 20) },
  ],
  truckZone: { x: 1, y: 1, w: 3, h: 2 },
  spawns: [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 1.5, y: 2.5 }, { x: 2.5, y: 2.5 }],
  itemSlots: [],
  patrolRoutes: [{ floor: 0, points: [{ x: 5.5, y: 5.5 }] }, { floor: 1, points: [{ x: 5.5, y: 5.5 }] }],
  lights: [],
  ...noStairs,
  zones: [],
};

/**
 * `wallSegments` 테스트용 맵. B1(층 0)은 8×5 열린 바닥에 2×1 단단한 블록 하나((3,2), (4,2))만 있다.
 * 맵 가장자리에는 벽을 두지 않는다. `wallSegments`는 "범위 밖 = 벽"으로 보지만 범위 안의 단단한 칸과
 * 범위 안의 비단단 칸 사이 변만 내보내므로 맵 경계는 선분을 만들지 않는다. 따라서 결과는 블록 외곽 4개다.
 * B2(층 1)는 단단한 칸이 없다.
 */
export const solid2x1: MapData = {
  id: 'solid2x1',
  floors: [
    { width: 8, height: 5, rows: ['........', '........', '...##...', '........', '........'] },
    { width: 8, height: 5, rows: ['........', '........', '........', '........', '........'] },
  ],
  truckZone: { x: 0, y: 0, w: 2, h: 2 },
  spawns: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }],
  itemSlots: [],
  patrolRoutes: [{ floor: 0, points: [{ x: 0.5, y: 4.5 }] }, { floor: 1, points: [{ x: 0.5, y: 4.5 }] }],
  lights: [],
  ...noStairs,
  zones: [],
};
