import { describe, expect, it } from 'vitest';
import { getMap, MAP_IDS } from '../src/map/index.ts';
import { bfsDistances, isSolid, isWalkableTile, stairsAt, tileAt } from '../src/map/grid.ts';
import { validateMap } from '../src/map/validate.ts';
import type { MapData } from '../src/map/types.ts';
import { cloneMap } from './fixtures/maps.ts';

function withItemSlotOnWall(m: MapData): MapData {
  const c = cloneMap(m);
  c.itemSlots[0] = { floor: 0, pos: { x: 0.5, y: 0.5 } };
  return c;
}

function withEnclosedItemSlot(m: MapData): MapData {
  const c = cloneMap(m);
  // 걸어갈 수 있는 한 칸(30,30)을 벽으로 완전히 둘러싼다.
  const rows = c.floors[0].rows.map((r) => r.split(''));
  for (let y = 29; y <= 31; y++) for (let x = 29; x <= 31; x++) rows[y]![x] = '#';
  rows[30]![30] = '.';
  c.floors[0].rows = rows.map((r) => r.join(''));
  c.itemSlots[0] = { floor: 0, pos: { x: 30.5, y: 30.5 } };
  return c;
}

function withBrokenStairs(m: MapData): MapData {
  const c = cloneMap(m);
  c.stairs[0]!.b.floor = c.stairs[0]!.a.floor; // 같은 층끼리 짝지어 층 이동이 안 된다
  return c;
}

describe('parking-lot 맵', () => {
  const map = getMap('parking-lot');

  it('parking-lot 맵은 검증을 통과', () => {
    expect(validateMap(map, 25)).toEqual([]);
  });

  it('MAP_IDS와 getMap', () => {
    expect(MAP_IDS).toEqual(['parking-lot']);
    expect(() => getMap('nope')).toThrow();
  });

  it('스펙 수치를 만족한다', () => {
    expect(map.floors[0].width).toBe(60);
    expect(map.floors[0].height).toBe(40);
    expect(map.floors[1].width).toBe(60);
    expect(map.floors[1].height).toBe(40);
    expect(map.truckZone.w).toBeGreaterThanOrEqual(6);
    expect(map.truckZone.h).toBeGreaterThanOrEqual(4);
    expect(map.spawns).toHaveLength(4);
    expect(map.itemSlots.length).toBeGreaterThanOrEqual(40);
    expect(map.itemSlots.some((s) => s.floor === 0)).toBe(true);
    expect(map.itemSlots.some((s) => s.floor === 1)).toBe(true);
    expect(map.stairs).toHaveLength(2);
    const b1 = map.lights.filter((l) => l.floor === 0).length;
    const b2 = map.lights.filter((l) => l.floor === 1).length;
    expect(b1).toBeGreaterThanOrEqual(12);
    expect(b2).toBeLessThanOrEqual(6);
    expect(b2).toBeLessThan(b1);
    expect(map.lights.filter((l) => l.flickering).length).toBeGreaterThanOrEqual(3);
    for (const f of [0, 1] as const) {
      const r = map.patrolRoutes.filter((p) => p.floor === f);
      expect(r.length).toBe(1);
      expect(r[0]!.points.length).toBeGreaterThanOrEqual(8);
    }
    const names = map.zones.map((z) => z.name).join('|');
    for (const n of ['주차 구역', '엘리베이터 홀', '계단실', '보일러실', '전기실', '창고', '경비실', '분리수거장']) {
      expect(names).toContain(n);
    }
  });

  it('조명 id는 유일', () => {
    expect(new Set(map.lights.map((l) => l.id)).size).toBe(map.lights.length);
  });
});

describe('validateMap', () => {
  const map = getMap('parking-lot');

  it('벽 위의 폐품 칸은 거부', () => {
    expect(validateMap(withItemSlotOnWall(map), 25).join()).toMatch(/itemSlot/);
  });
  it('트럭까지 못 가는 폐품 칸은 거부', () => {
    expect(validateMap(withEnclosedItemSlot(map), 25).join()).toMatch(/unreachable/);
  });
  it('짝 없는 계단은 거부', () => {
    expect(validateMap(withBrokenStairs(map), 25).join()).toMatch(/stairs/);
  });
  it('폐품 칸이 필요 개수보다 적으면 거부', () => {
    expect(validateMap(map, 10_000).join()).toMatch(/itemSlots/);
  });
  it('시작 위치가 트럭 구역 밖이면 거부', () => {
    const c = cloneMap(map);
    c.spawns[0] = { x: 30.5, y: 30.5 };
    expect(validateMap(c, 25).join()).toMatch(/spawn/);
  });
  it('순찰 경로가 없는 층은 거부', () => {
    const c = cloneMap(map);
    c.patrolRoutes = c.patrolRoutes.filter((p) => p.floor === 0);
    expect(validateMap(c, 25).join()).toMatch(/patrol/);
  });
});

describe('grid', () => {
  const map = getMap('parking-lot');

  it('범위 밖은 벽', () => {
    expect(tileAt(map, 0, -1, 0)).toBe('wall');
    expect(tileAt(map, 0, 0, 40)).toBe('wall');
    expect(tileAt(map, 1, 60, 0)).toBe('wall');
  });

  it('isSolid / isWalkableTile', () => {
    expect(isSolid('wall') && isSolid('pillar') && isSolid('car')).toBe(true);
    expect(isSolid('floor') || isSolid('stairs')).toBe(false);
    expect(isWalkableTile(map, 0, 0, 0)).toBe(false);
    const s = map.spawns[0]!;
    expect(isWalkableTile(map, 0, Math.floor(s.x), Math.floor(s.y))).toBe(true);
  });

  it('bfsDistances: 시작점 0, 벽은 -1, 같은 층만', () => {
    const s = map.spawns[0]!;
    const d = bfsDistances(map, 0, s);
    const w = map.floors[0].width;
    expect(d[Math.floor(s.y) * w + Math.floor(s.x)]).toBe(0);
    expect(d[0]).toBe(-1);
    const other = map.truckZone;
    expect(d[(other.y + 1) * w + other.x + 1]).toBeGreaterThanOrEqual(0);
  });

  it('stairsAt: 반대편을 돌려주고 계단이 아니면 null', () => {
    const st = map.stairs[0]!;
    expect(stairsAt(map, st.a.floor, st.a.tile)).toEqual(st.b);
    expect(stairsAt(map, st.b.floor, st.b.tile)).toEqual(st.a);
    expect(stairsAt(map, 0, { x: 0, y: 0 })).toBeNull();
  });
});
