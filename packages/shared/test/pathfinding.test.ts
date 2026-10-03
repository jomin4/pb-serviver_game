import { describe, expect, it } from 'vitest';
import { findPath, pathLength } from '../src/pathfinding.ts';
import { isWalkableTile, stairsAt } from '../src/map/grid.ts';
import { getMap } from '../src/map/index.ts';
import type { MapData } from '../src/map/types.ts';
import type { FloorId, Vec } from '../src/types.ts';
import { at, cloneMap, tinyMap as tiny } from './fixtures/maps.ts';

type Node = { floor: FloorId; pos: Vec };
const tileOf = (n: Node): [number, number] => [Math.floor(n.pos.x), Math.floor(n.pos.y)];

/** 같은 층 안에서 이어지는 두 노드 사이의 대각선 이동이 모서리를 자르지 않는지 확인한다. */
function noCornerCutting(map: MapData, start: Node, path: Node[]): boolean {
  let prev = start;
  for (const n of path) {
    if (n.floor === prev.floor) {
      const [px, py] = tileOf(prev);
      const [nx, ny] = tileOf(n);
      if (nx !== px && ny !== py) {
        if (!isWalkableTile(map, n.floor, nx, py) || !isWalkableTile(map, n.floor, px, ny)) return false;
      }
    }
    prev = n;
  }
  return true;
}

describe('findPath', () => {
  it('직선 경로', () => {
    const p = findPath(tiny, at(0, 1, 1), at(0, 5, 1))!;
    expect(p.at(-1)!.pos).toEqual({ x: 5.5, y: 1.5 });
    expect(p.length).toBe(4);
    expect(p.map((n) => n.pos.x)).toEqual([2.5, 3.5, 4.5, 5.5]);
    expect(p.every((n) => n.floor === 0 && n.pos.y === 1.5)).toBe(true);
  });

  it('벽을 돌아간다', () => {
    const p = findPath(tiny, at(0, 1, 3), at(0, 8, 3))!;
    expect(p.every((n) => isWalkableTile(tiny, n.floor, Math.floor(n.pos.x), Math.floor(n.pos.y)))).toBe(true);
    expect(p.at(-1)!.pos).toEqual({ x: 8.5, y: 3.5 });
    // 중간 벽(x=5, y=2..4)은 y=1에서만 열려 있다.
    expect(p.some((n) => Math.floor(n.pos.x) === 5 && Math.floor(n.pos.y) === 1)).toBe(true);
    expect(p.some((n) => Math.floor(n.pos.x) === 5 && Math.floor(n.pos.y) >= 2)).toBe(false);
  });

  it('대각선은 모서리를 자르지 않는다', () => {
    // 벽 끝 (5,2) 옆: (4,2)→(5,1)은 옆 칸 (5,2)가 벽이라 대각선 한 번에 갈 수 없다.
    const p = findPath(tiny, at(0, 4, 2), at(0, 5, 1))!;
    expect(p).toHaveLength(2);
    expect(p[0]!.pos).toEqual({ x: 4.5, y: 1.5 });
    expect(p[1]!.pos).toEqual({ x: 5.5, y: 1.5 });
    // 반대쪽 (6,2)→(5,1)도 마찬가지.
    const q = findPath(tiny, at(0, 6, 2), at(0, 5, 1))!;
    expect(q).toHaveLength(2);
    expect(q[0]!.pos).toEqual({ x: 6.5, y: 1.5 });
    // 열린 곳에서는 대각선을 쓴다.
    expect(findPath(tiny, at(0, 1, 1), at(0, 3, 3))).toHaveLength(2);
  });

  it('모든 경로에서 대각선 이동의 양옆 칸이 비어 있다', () => {
    const pairs: [Node, Node][] = [
      [at(0, 1, 3), at(0, 8, 3)],
      [at(0, 4, 4), at(0, 6, 4)],
      [at(0, 1, 1), at(0, 8, 4)],
      [at(1, 1, 4), at(1, 8, 1)],
    ];
    for (const [a, b] of pairs) {
      expect(noCornerCutting(tiny, a, findPath(tiny, a, b)!)).toBe(true);
    }
    const lot = getMap('parking-lot');
    const a = { floor: 0 as FloorId, pos: lot.spawns[0]! };
    const far = lot.itemSlots.filter((s) => s.floor === 0).at(-1)!;
    const p = findPath(lot, a, far)!;
    expect(p).not.toBeNull();
    expect(noCornerCutting(lot, a, p)).toBe(true);
  });

  it('계단으로 다른 층에 간다', () => {
    const p = findPath(tiny, at(0, 1, 1), at(1, 8, 4))!;
    expect(p.some((n) => n.floor === 1)).toBe(true);
    // 층이 바뀌는 지점의 노드는 도착 층의 계단 칸 중심이다.
    const i = p.findIndex((n) => n.floor === 1);
    expect(p[i - 1]!.floor).toBe(0);
    expect(p[i]!.pos).toEqual({ x: 7.5, y: 1.5 });
    expect(stairsAt(tiny, 0, { x: 2, y: 4 })).toEqual({ floor: 1, tile: { x: 7, y: 1 } });
    expect(p.at(-1)).toEqual(at(1, 8, 4));
    // 층 전환은 한 번뿐이다.
    expect(p.filter((n, k) => k > 0 && n.floor !== p[k - 1]!.floor)).toHaveLength(1);
  });

  it('아래층에서 위층으로도 돌아온다', () => {
    const p = findPath(tiny, at(1, 8, 4), at(0, 1, 1))!;
    expect(p.at(-1)).toEqual(at(0, 1, 1));
    const i = p.findIndex((n) => n.floor === 0);
    expect(p[i]!.pos).toEqual({ x: 2.5, y: 4.5 });
  });

  it('경로가 없으면 null', () => {
    expect(findPath(tiny, at(0, 1, 1), at(0, 9, 0))).toBeNull(); // (9,0)은 벽
    expect(findPath(tiny, at(0, 9, 0), at(0, 1, 1))).toBeNull(); // 출발 칸이 벽
  });

  it('막힌 구역과 계단 없는 맵에서도 null', () => {
    const boxed = cloneMap(tiny);
    const rows = boxed.floors[0].rows.map((r) => r.split(''));
    // (8,3) 한 칸만 남기고 둘레 여덟 칸을 모두 벽으로 막는다.
    for (let y = 2; y <= 4; y++) for (let x = 7; x <= 9; x++) rows[y]![x] = '#';
    rows[3]![8] = '.';
    boxed.floors[0].rows = rows.map((r) => r.join(''));
    expect(isWalkableTile(boxed, 0, 8, 3)).toBe(true);
    expect(findPath(boxed, at(0, 1, 1), at(0, 8, 3))).toBeNull();

    const noStairs = cloneMap(tiny);
    noStairs.stairs = [];
    expect(findPath(noStairs, at(0, 1, 1), at(1, 8, 4))).toBeNull();
    expect(findPath(noStairs, at(0, 1, 1), at(0, 8, 4))).not.toBeNull();
  });

  it('타일 안 어느 점이든 타일로 내림해 쓴다', () => {
    const p = findPath(tiny, { floor: 0, pos: { x: 1.9, y: 1.1 } }, { floor: 0, pos: { x: 5.2, y: 1.8 } })!;
    expect(p).toHaveLength(4);
    expect(p.at(-1)!.pos).toEqual({ x: 5.5, y: 1.5 });
  });

  it('출발 칸과 도착 칸이 같으면 빈 경로', () => {
    expect(findPath(tiny, at(0, 3, 3), { floor: 0, pos: { x: 3.9, y: 3.1 } })).toEqual([]);
  });

  it('같은 입력이면 같은 경로(결정적)', () => {
    const a = findPath(tiny, at(0, 1, 3), at(1, 8, 4));
    const b = findPath(tiny, at(0, 1, 3), at(1, 8, 4));
    expect(a).toEqual(b);
  });

  it('입력 맵과 위치를 바꾸지 않는다', () => {
    const before = JSON.stringify(tiny);
    const from = at(0, 1, 1);
    findPath(tiny, from, at(1, 8, 4));
    expect(JSON.stringify(tiny)).toBe(before);
    expect(from).toEqual(at(0, 1, 1));
  });

  it('계단 칸에서 출발해 같은 층을 걸을 수 있다', () => {
    // 계단 칸 위에 서 있는 상태(순간 이동 직후)에서 출발한다.
    const p = findPath(tiny, at(0, 2, 4), at(0, 4, 4))!;
    expect(p.map((n) => n.floor)).toEqual([0, 0]);
    expect(p.at(-1)).toEqual(at(0, 4, 4));
  });

  it('계단 칸이 도착지면 반대편에서 순간 이동해 도착한다', () => {
    const p = findPath(tiny, at(0, 1, 1), at(1, 7, 1))!;
    expect(p.at(-1)).toEqual(at(1, 7, 1));
    expect(p.at(-1)!.floor).toBe(1);
  });

  it('실제 맵에서 두 층을 잇는 경로를 찾는다', () => {
    const lot = getMap('parking-lot');
    const from = { floor: 0 as FloorId, pos: lot.spawns[0]! };
    const slot = lot.itemSlots.find((s) => s.floor === 1)!;
    const p = findPath(lot, from, { floor: 1, pos: slot.pos })!;
    expect(p).not.toBeNull();
    expect(p.at(-1)!.floor).toBe(1);
    expect(p.at(-1)!.pos).toEqual({ x: Math.floor(slot.pos.x) + 0.5, y: Math.floor(slot.pos.y) + 0.5 });
  });
});

describe('pathLength', () => {
  it('같은 층은 유클리드 거리의 합', () => {
    const p = findPath(tiny, at(0, 1, 1), at(0, 5, 1))!;
    expect(pathLength(p)).toBeCloseTo(3); // 시작 칸 제외: 노드 4개, 간격 3
    expect(pathLength([at(0, 1, 1), at(0, 2, 2)])).toBeCloseTo(Math.SQRT2);
  });

  it('층이 바뀌면 계단 비용 1을 더한다', () => {
    expect(pathLength([at(0, 2, 3), at(1, 7, 1), at(1, 8, 1)])).toBeCloseTo(2);
  });

  it('빈 경로나 노드 하나면 0', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([at(0, 1, 1)])).toBe(0);
  });
});
