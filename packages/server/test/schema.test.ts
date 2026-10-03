import { describe, expect, it } from 'vitest';
import { MAP_IDS, createWorld } from '@bh/shared';
import type { World } from '@bh/shared';
import { PlayerS, RoomState, syncSchema } from '../src/schema.ts';

const mkWorld = (n = 2): World =>
  createWorld({ mapId: MAP_IDS[0]!, seed: 7, players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `이름${i + 1}` })) });

describe('syncSchema', () => {
  it('world 값을 스키마로 복사한다', () => {
    const world = mkWorld(2);
    world.players.p1!.pos = { x: 3.5, y: 4.25 };
    world.players.p1!.inventory = ['item-1', 'item-2'];
    world.players.p1!.exhausted = true;
    world.round.truckTotal = 120;
    const state = new RoomState();
    syncSchema(world, state);

    const p = state.players.get('p1')!;
    expect([p.x, p.y]).toEqual([3.5, 4.25]);
    expect([...p.inventory]).toEqual(['item-1', 'item-2']);
    expect(p.exhausted).toBe(true);
    expect(p.name).toBe('이름1');
    expect(state.mapId).toBe(world.mapId);
    expect(state.seed).toBe(7);
    expect(state.target).toBe(world.round.target);
    expect(state.truckTotal).toBe(120);
    expect(state.result).toBe('');
    expect(state.players.size).toBe(2);
    expect(state.items.size).toBe(Object.keys(world.items).length);
    expect(state.lights.size).toBe(world.lights.length);
    expect(state.monsters.size).toBe(world.stalkers.length + 1);
    expect(state.monsters.get('watcher')!.kind).toBe('watcher');
    expect(state.monsters.get('stalker-1')!.kind).toBe('stalker');
    expect(state.monsters.get('stalker-1')!.mode).toBe('patrol');
  });

  it('결과 단계는 result로 복사된다', () => {
    const world = mkWorld(1);
    world.round.phase = 'success';
    const state = new RoomState();
    syncSchema(world, state);
    expect(state.result).toBe('success');
  });

  it('world에 없는 키는 삭제한다', () => {
    const world = mkWorld(2);
    const state = new RoomState();
    syncSchema(world, state);
    const someItem = Object.keys(world.items)[0]!;
    delete world.items[someItem];
    delete world.players.p2;
    world.lights.pop();
    syncSchema(world, state);
    expect(state.items.has(someItem)).toBe(false);
    expect(state.players.has('p2')).toBe(false);
    expect(state.players.has('p1')).toBe(true);
    expect(state.lights.size).toBe(world.lights.length);
  });

  it('인벤토리가 줄면 스키마 배열도 준다', () => {
    const world = mkWorld(1);
    const state = new RoomState();
    world.players.p1!.inventory = ['a', 'b', 'c'];
    syncSchema(world, state);
    world.players.p1!.inventory = ['b'];
    syncSchema(world, state);
    expect([...state.players.get('p1')!.inventory]).toEqual(['b']);
  });

  it('대기실 플레이어 항목은 새로 만들지 않고 제자리에서 갱신한다', () => {
    const state = new RoomState();
    const lobby = new PlayerS();
    lobby.id = 'p1'; lobby.name = '대기실'; lobby.colorIndex = 2; lobby.joinOrder = 5; lobby.isHost = true;
    state.players.set('p1', lobby);
    syncSchema(mkWorld(1), state);
    const after = state.players.get('p1')!;
    expect(after).toBe(lobby);
    expect(after.colorIndex).toBe(2);
    expect(after.joinOrder).toBe(5);
    expect(after.isHost).toBe(true);
    expect(after.name).toBe('이름1');
    expect(after.hp).toBeGreaterThan(0);
  });
});

