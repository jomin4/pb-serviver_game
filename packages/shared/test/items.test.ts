import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { createRng } from '../src/rng.ts';
import { getMap } from '../src/map/index.ts';
import {
  ITEM_KINDS,
  dropAll,
  dropSelected,
  itemCountFor,
  loadIntoTruck,
  nearestPickable,
  pickUp,
  spawnItems,
} from '../src/items.ts';
import type { World } from '../src/types.ts';
import { makeItem, makePlayer, makeWorld } from './fixtures/world.ts';

const map = getMap('parking-lot');
const PLAYER_COUNTS = [1, 2, 3, 4] as const;

/** 플레이어 A가 (5,5)에 서 있고 폐품 n개가 발치에 놓인 월드. */
function setup(itemCount: number, itemPartial = {}): World {
  const items = Object.fromEntries(
    Array.from({ length: itemCount }, (_, i) => [
      `i${i}`,
      makeItem(`i${i}`, 3, { value: 10 * (i + 1), pos: { x: 5.2 + i * 0.1, y: 5 }, ...itemPartial }),
    ]),
  );
  return makeWorld({
    players: {
      A: makePlayer({ id: 'A', pos: { x: 5, y: 5 } }),
      B: makePlayer({ id: 'B', pos: { x: 5, y: 5 } }),
    },
    items,
  });
}

describe('itemCountFor', () => {
  it('1/2/3/4인은 10/14/19/25개', () => {
    expect(PLAYER_COUNTS.map(itemCountFor)).toEqual([10, 14, 19, 25]);
  });
});

describe('spawnItems', () => {
  it.each(PLAYER_COUNTS)('%i인: 총액은 1.8×목표 ±5%, 값·무게 범위', (n) => {
    const items = Object.values(spawnItems(map, createRng(3), n));
    const total = items.reduce((s, i) => s + i.value, 0), goal = 1.8 * CONFIG.difficulty[n].target;
    expect(items).toHaveLength(itemCountFor(n));
    expect(total).toBeGreaterThanOrEqual(goal * 0.95); expect(total).toBeLessThanOrEqual(goal * 1.05);
    expect(items.every(i => i.value >= 10 && i.value <= 80 && i.weight >= 2 && i.weight <= 15)).toBe(true);
    expect(new Set(items.map(i => `${i.floor}:${i.pos.x}:${i.pos.y}`)).size).toBe(items.length);
  });

  it('시드 1~50, 1~4인 모두 throw 없이 범위를 지킨다', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const n of PLAYER_COUNTS) {
        const items = Object.values(spawnItems(map, createRng(seed), n));
        const total = items.reduce((s, i) => s + i.value, 0), goal = CONFIG.items.totalFactor * CONFIG.difficulty[n].target;
        expect(items).toHaveLength(itemCountFor(n));
        expect(Math.abs(total - goal)).toBeLessThanOrEqual(goal * 0.05);
        expect(items.every(i => Number.isInteger(i.value) && Number.isInteger(i.weight)
          && i.value >= CONFIG.items.valueMin && i.value <= CONFIG.items.valueMax
          && i.weight >= CONFIG.items.weightMin && i.weight <= CONFIG.items.weightMax)).toBe(true);
      }
    }
  });

  it('같은 시드는 같은 결과, 다른 시드는 다른 결과', () => {
    const a = spawnItems(map, createRng(7), 4);
    expect(spawnItems(map, createRng(7), 4)).toEqual(a);
    expect(spawnItems(map, createRng(8), 4)).not.toEqual(a);
  });

  it('id는 item-0부터 생성 순서, 초기 상태와 슬롯 위치·층, 종류', () => {
    const items = spawnItems(map, createRng(5), 2);
    const list = Object.values(items);
    expect(Object.keys(items)).toEqual(list.map((_, i) => `item-${i}`));
    for (const it of list) {
      expect(it.carriedBy).toBeNull();
      expect(it.loaded).toBe(false);
      expect(ITEM_KINDS).toContain(it.kind);
      expect(map.itemSlots.some(s => s.floor === it.floor && s.pos.x === it.pos.x && s.pos.y === it.pos.y)).toBe(true);
    }
  });

  it('위치는 슬롯의 복사본이다(맵 데이터를 공유하지 않는다)', () => {
    const [it] = Object.values(spawnItems(map, createRng(5), 1));
    const slot = map.itemSlots.find(s => s.floor === it.floor && s.pos.x === it.pos.x && s.pos.y === it.pos.y)!;
    expect(it.pos).not.toBe(slot.pos);
  });

  it('슬롯이 모자라면 throw', () => {
    expect(() => spawnItems({ ...map, itemSlots: map.itemSlots.slice(0, 5) }, createRng(1), 4)).toThrow();
  });
});

describe('nearestPickable', () => {
  it('범위 안에서 가장 가까운 바닥 폐품을 고른다', () => {
    const w = setup(3);
    expect(nearestPickable(w, 'A')).toBe('i0');
  });

  it('다른 층, 범위 밖, 들린 것, 실린 것은 제외', () => {
    const w = setup(4);
    w.items.i0.floor = 1;
    w.items.i1.carriedBy = 'B';
    w.items.i2.loaded = true;
    w.items.i3.pos = { x: 5 + CONFIG.player.interactRange + 0.1, y: 5 };
    expect(nearestPickable(w, 'A')).toBeNull();
    w.items.i3.pos = { x: 5 + CONFIG.player.interactRange - 0.1, y: 5 };
    expect(nearestPickable(w, 'A')).toBe('i3');
  });

  it('유령이거나 없는 플레이어면 null', () => {
    const w = setup(1);
    w.players.A.alive = false;
    expect(nearestPickable(w, 'A')).toBeNull();
    expect(nearestPickable(w, 'nobody')).toBeNull();
  });
});

describe('pickUp', () => {
  it('줍기: carriedBy 설정, inventory에 추가', () => {
    const w = setup(1);
    pickUp(w, 'A', 'i0');
    expect(w.items.i0.carriedBy).toBe('A');
    expect(w.players.A.inventory).toEqual(['i0']);
  });

  it('3칸이 차면 더 줍지 못한다', () => {
    const w = setup(4);
    for (const id of ['i0', 'i1', 'i2', 'i3']) pickUp(w, 'A', id);
    expect(w.players.A.inventory).toHaveLength(CONFIG.player.slots);
    expect(w.players.A.inventory).toEqual(['i0', 'i1', 'i2']);
    expect(w.items.i3.carriedBy).toBeNull();
  });

  it('같은 틱에 두 명이 같은 폐품을 주우면 한 명만 갖는다', () => {
    const w = setup(1);
    pickUp(w, 'A', 'i0');
    pickUp(w, 'B', 'i0');
    expect(w.items.i0.carriedBy).toBe('A');
    expect(w.players.A.inventory).toEqual(['i0']);
    expect(w.players.B.inventory).toEqual([]);
  });

  it('다른 층, 범위 밖, 실린 것, 유령, 없는 id는 무시', () => {
    const w = setup(4);
    w.items.i0.floor = 1;
    w.items.i1.pos = { x: 5 + CONFIG.player.interactRange + 0.1, y: 5 };
    w.items.i2.loaded = true;
    for (const id of ['i0', 'i1', 'i2', 'nope']) pickUp(w, 'A', id);
    expect(w.players.A.inventory).toEqual([]);
    w.players.A.alive = false;
    pickUp(w, 'A', 'i3');
    expect(w.players.A.inventory).toEqual([]);
    expect(w.items.i3.carriedBy).toBeNull();
  });
});

describe('dropSelected', () => {
  it('선택한 칸의 폐품을 플레이어 위치에 떨어뜨리고 칸 인덱스를 보정한다', () => {
    const w = setup(3);
    for (const id of ['i0', 'i1', 'i2']) pickUp(w, 'A', id);
    w.players.A.selectedSlot = 2;
    w.players.A.pos = { x: 7, y: 8 };
    w.players.A.floor = 1;
    expect(dropSelected(w, 'A')).toBe('i2');
    expect(w.players.A.inventory).toEqual(['i0', 'i1']);
    expect(w.players.A.selectedSlot).toBe(1);
    expect(w.items.i2).toMatchObject({ carriedBy: null, floor: 1, pos: { x: 7, y: 8 } });
    expect(w.items.i2.pos).not.toBe(w.players.A.pos);
  });

  it('선택한 칸이 비어 있으면 null, 변화 없음', () => {
    const w = setup(1);
    pickUp(w, 'A', 'i0');
    w.players.A.selectedSlot = 1;
    expect(dropSelected(w, 'A')).toBeNull();
    expect(w.players.A.inventory).toEqual(['i0']);
  });

  it('마지막 하나를 버리면 selectedSlot은 0', () => {
    const w = setup(1);
    pickUp(w, 'A', 'i0');
    expect(dropSelected(w, 'A')).toBe('i0');
    expect(w.players.A.inventory).toEqual([]);
    expect(w.players.A.selectedSlot).toBe(0);
  });
});

describe('dropAll', () => {
  it('dropAll은 소지품을 그 자리에 떨어뜨린다', () => {
    const w = setup(3);
    for (const id of ['i0', 'i1', 'i2']) pickUp(w, 'A', id);
    w.players.A.pos = { x: 9, y: 4 };
    w.players.A.selectedSlot = 2;
    dropAll(w, 'A');
    expect(w.players.A.inventory).toEqual([]);
    expect(w.players.A.selectedSlot).toBe(0);
    for (const id of ['i0', 'i1', 'i2']) {
      expect(w.items[id].pos).toEqual({ x: 9, y: 4 });
      expect(w.items[id].carriedBy).toBeNull();
      expect(w.items[id].floor).toBe(w.players.A.floor);
    }
  });
});

describe('loadIntoTruck', () => {
  it('loadIntoTruck은 총액과 개인 누계를 올리고 loaded 처리', () => {
    const w = setup(3); // 값 10, 20, 30
    w.round.truckTotal = 100;
    w.players.A.carriedTotal = 5;
    pickUp(w, 'A', 'i0'); pickUp(w, 'A', 'i1');
    expect(loadIntoTruck(w, 'A')).toBe(30);
    expect(w.round.truckTotal).toBe(130);
    expect(w.players.A.carriedTotal).toBe(35);
    expect(w.players.A.inventory).toEqual([]);
    expect(w.items.i0).toMatchObject({ loaded: true, carriedBy: null });
    expect(w.items.i1).toMatchObject({ loaded: true, carriedBy: null });
    expect(w.items.i2.loaded).toBe(false);
  });

  it('빈 손이면 0을 돌려주고 아무것도 바뀌지 않는다', () => {
    const w = setup(1);
    expect(loadIntoTruck(w, 'A')).toBe(0);
    expect(w.round.truckTotal).toBe(0);
  });
});
