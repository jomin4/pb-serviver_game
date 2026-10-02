import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { dist } from '../src/geometry.ts';
import { getMap } from '../src/map/index.ts';
import type { MapData } from '../src/map/types.ts';
import { emitNoise } from '../src/noise.ts';
import { isWatcherLit, updateWatcher, watcherContacts } from '../src/monsters/watcher.ts';
import type { FloorId, PlayerState, Vec, World } from '../src/types.ts';
import { at, open20, open20Wall, tinyMap } from './fixtures/maps.ts';
import { makePlayer, makeWorld } from './fixtures/world.ts';

const W = CONFIG.watcher;
const DT = 0.05;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const REACH = CONFIG.player.radius + W.radius;

/** 활성 시선형과 플레이어들이 있는 월드. 시선형 기본 위치는 B1 (3.5, 10.5). */
const mkWorld = (
  players: Partial<PlayerState>[],
  watcher: { floor?: FloorId; pos?: Vec; active?: boolean } = {},
): World => {
  const list = players.map((p, i) => makePlayer({ id: `p${i + 1}`, name: `p${i + 1}`, ...p }));
  const world = makeWorld({ players: Object.fromEntries(list.map((p) => [p.id, p])) });
  world.watcher = {
    ...world.watcher,
    floor: watcher.floor ?? 0,
    pos: watcher.pos ?? { x: 3.5, y: 10.5 },
    active: watcher.active ?? true,
  };
  return world;
};

/** `step`이 하듯 시간을 흘리며 `seconds`초 진행한다. */
const run = (world: World, map: MapData, seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.time += DT;
    world.events = [];
    updateWatcher(world, map, DT);
  }
};

/** 시선형을 +x 쪽에서 -x 방향(π)으로 비추는 살아 있는 플레이어. 거리 4, 사거리 8 안. */
const lighter = (partial: Partial<PlayerState> = {}): Partial<PlayerState> => ({
  pos: { x: 7.5, y: 10.5 },
  aim: Math.PI,
  flashlightOn: true,
  ...partial,
});

describe('isWatcherLit', () => {
  it('같은 층 생존자가 손전등으로 비추면 true', () => {
    expect(isWatcherLit(mkWorld([lighter()]), open20)).toBe(true);
  });

  it('비활성이면 false', () => {
    expect(isWatcherLit(mkWorld([lighter()], { active: false }), open20)).toBe(false);
  });

  it('유령이 비추는 것은 무효', () => {
    expect(isWatcherLit(mkWorld([lighter({ alive: false })]), open20)).toBe(false);
  });

  it('손전등이 꺼져 있으면 무효', () => {
    expect(isWatcherLit(mkWorld([lighter({ flashlightOn: false })]), open20)).toBe(false);
  });

  it('다른 층에서 비추면 무효', () => {
    expect(isWatcherLit(mkWorld([lighter({ floor: 1 })]), open20)).toBe(false);
  });

  it('부채꼴 밖이거나 사거리 밖이면 무효', () => {
    expect(isWatcherLit(mkWorld([lighter({ aim: 0 })]), open20)).toBe(false);
    expect(isWatcherLit(mkWorld([lighter({ pos: { x: 13.5, y: 10.5 } })]), open20)).toBe(false);
  });

  it('벽 뒤에서 비추는 것은 무효', () => {
    const world = mkWorld([lighter({ pos: { x: 12.5, y: 10.5 } })], { pos: { x: 7.5, y: 10.5 } });
    expect(isWatcherLit(world, open20Wall)).toBe(false);
    expect(isWatcherLit(world, open20)).toBe(true); // 벽이 없으면 같은 배치에서 비춘다
  });

  it('여럿 중 한 명만 비춰도 true', () => {
    const world = mkWorld([lighter({ flashlightOn: false }), lighter({ alive: false }), lighter({ pos: { x: 6.5, y: 10.5 } })]);
    expect(isWatcherLit(world, open20)).toBe(true);
  });
});

describe('updateWatcher: 정지', () => {
  it('생존자가 비추면 1초가 지나도 위치가 변하지 않고 frozen', () => {
    const world = mkWorld([lighter({ pos: { x: 10.5, y: 10.5 } })]);
    run(world, open20, 1);
    expect(world.watcher.pos).toEqual({ x: 3.5, y: 10.5 });
    expect(world.watcher.frozen).toBe(true);
    expect(world.watcher.moving).toBe(false);
  });

  it('얼어 있는 동안 경로를 지우지 않고, 풀리면 다시 이동한다', () => {
    const world = mkWorld([{ pos: { x: 9.5, y: 10.5 } }]);
    run(world, open20, 0.2);
    const pathBefore = clone(world.watcher.path);
    const posBefore = { ...world.watcher.pos };
    expect(pathBefore.length).toBeGreaterThan(0);
    // 플레이어가 시선형 쪽으로 돌아서 비춘다(시선형 위치는 그대로, 거리 < 8).
    Object.assign(world.players.p1!, { flashlightOn: true, aim: Math.PI });
    run(world, open20, 0.5);
    expect(world.watcher.frozen).toBe(true);
    expect(world.watcher.pos).toEqual(posBefore);
    expect(world.watcher.path).toEqual(pathBefore);
    world.players.p1!.flashlightOn = false;
    run(world, open20, 0.2);
    expect(world.watcher.frozen).toBe(false);
    expect(world.watcher.pos.x).toBeGreaterThan(posBefore.x);
  });

  it('유령이 비추는 것은 무효: 이동한다', () => {
    const world = mkWorld([lighter({ alive: false }), { pos: { x: 15.5, y: 10.5 } }]);
    run(world, open20, 0.5);
    expect(world.watcher.frozen).toBe(false);
    expect(world.watcher.pos.x).toBeGreaterThan(3.5);
  });

  it('손전등이 꺼져 있으면 무효: 이동한다', () => {
    const world = mkWorld([lighter({ flashlightOn: false, pos: { x: 15.5, y: 10.5 } })]);
    run(world, open20, 0.5);
    expect(world.watcher.frozen).toBe(false);
    expect(world.watcher.moving).toBe(true);
    expect(world.watcher.pos.x).toBeGreaterThan(3.5);
  });

  it('벽 뒤에서 비추는 것은 무효: 이동한다', () => {
    const world = mkWorld([lighter({ pos: { x: 12.5, y: 10.5 } })], { pos: { x: 7.5, y: 10.5 } });
    run(world, open20Wall, 0.5);
    expect(world.watcher.frozen).toBe(false);
    expect(world.watcher.moving).toBe(true);
    expect(dist(world.watcher.pos, { x: 7.5, y: 10.5 })).toBeGreaterThan(2);
  });

  it('비활성이면 아무것도 바꾸지 않는다', () => {
    const world = mkWorld([lighter()], { active: false });
    const before = clone(world.watcher);
    run(world, open20, 1);
    expect(world.watcher).toEqual(before);
  });
});

describe('updateWatcher: 이동', () => {
  it('비추지 않으면 초당 5.5타일로 플레이어에게 접근한다', () => {
    const world = mkWorld([{ pos: { x: 17.5, y: 10.5 } }]);
    run(world, open20, 1);
    expect(world.watcher.pos.x).toBeCloseTo(3.5 + W.speed, 6);
    expect(world.watcher.pos.y).toBeCloseTo(10.5, 6);
    expect(world.watcher.moving).toBe(true);
    expect(world.watcher.frozen).toBe(false);
  });

  it('한 틱에 speed*dt만큼 간다', () => {
    const world = mkWorld([{ pos: { x: 17.5, y: 10.5 } }]);
    updateWatcher(world, open20, DT);
    expect(world.watcher.pos.x).toBeCloseTo(3.5 + W.speed * DT, 9);
  });

  it('경로 길이가 가장 짧은 생존자를 고른다', () => {
    // p1은 직선 거리로는 더 가깝지만 벽을 돌아가야 해서 경로가 길다.
    const world = mkWorld([{ pos: { x: 12.5, y: 10.5 } }, { pos: { x: 3.5, y: 17.5 } }], { pos: { x: 7.5, y: 10.5 } });
    run(world, open20Wall, 0.5);
    expect(world.watcher.pos.y).toBeGreaterThan(11);
    expect(world.watcher.pos.x).toBeLessThan(7.6);
  });

  it('경로 길이가 같으면 id가 낮은 생존자를 고른다', () => {
    const world = mkWorld([{ pos: { x: 3.5, y: 4.5 } }, { pos: { x: 3.5, y: 16.5 } }]);
    run(world, open20, 0.5);
    expect(world.watcher.pos.y).toBeLessThan(10.5);
  });

  it('더 가까운 다른 생존자가 생기면 0.5초 안에 목표를 바꾼다', () => {
    const world = mkWorld([{ pos: { x: 10.5, y: 10.5 } }, { pos: { x: 3.5, y: 18.5 } }]);
    run(world, open20, 0.25);
    expect(world.watcher.pos.x).toBeGreaterThan(3.5);
    world.players.p2!.pos = { x: 6.0, y: 7.5 };
    run(world, open20, 0.6);
    expect(world.watcher.pos.y).toBeLessThan(10.5);
  });

  it('유령은 목표가 아니다', () => {
    const world = mkWorld([{ pos: { x: 3.5, y: 4.5 }, alive: false }, { pos: { x: 17.5, y: 10.5 } }]);
    run(world, open20, 0.5);
    expect(world.watcher.pos.x).toBeGreaterThan(3.5);
    expect(world.watcher.pos.y).toBeCloseTo(10.5, 6);
  });

  it('목표가 움직이면 따라간다', () => {
    const world = mkWorld([{ pos: { x: 17.5, y: 10.5 } }]);
    run(world, open20, 0.5);
    world.players.p1!.pos = { x: 6.5, y: 16.5 };
    run(world, open20, 3);
    expect(dist(world.watcher.pos, world.players.p1!.pos)).toBeLessThan(REACH);
  });

  it('도착한 뒤에는 타일 안의 실제 위치로 곧장 간다', () => {
    const world = mkWorld([{ pos: { x: 9.9, y: 10.9 } }]);
    run(world, open20, 2);
    expect(dist(world.watcher.pos, world.players.p1!.pos)).toBeLessThan(0.05);
  });

  it('벽을 돌아서 간다', () => {
    const world = mkWorld([{ pos: { x: 14.5, y: 10.5 } }], { pos: { x: 6.5, y: 10.5 } });
    run(world, open20Wall, 6);
    expect(dist(world.watcher.pos, world.players.p1!.pos)).toBeLessThan(REACH);
  });

  it('계단을 타고 다른 층 플레이어에게 간다', () => {
    const world = mkWorld([{ pos: at(1, 4, 3).pos, floor: 1 }], { pos: at(0, 1, 1).pos });
    let switchedAt = -1;
    for (let i = 0; i < 200 && dist(world.watcher.pos, world.players.p1!.pos) >= REACH; i++) {
      run(world, tinyMap, DT);
      if (switchedAt < 0 && world.watcher.floor === 1) switchedAt = i;
    }
    expect(switchedAt).toBeGreaterThanOrEqual(0);
    expect(world.watcher.floor).toBe(1);
    expect(dist(world.watcher.pos, world.players.p1!.pos)).toBeLessThan(REACH);
  });

  it('다른 층에서 비춰도 얼지 않는다(같은 층만 유효)', () => {
    const world = mkWorld([lighter({ floor: 1 })], { pos: { x: 3.5, y: 10.5 } });
    run(world, open20, 0.5);
    expect(world.watcher.frozen).toBe(false);
  });
});

describe('updateWatcher: 경로 없음', () => {
  it('경로가 없으면 1초 대기 후 재탐색한다', () => {
    // open20은 계단이 없어 다른 층 플레이어에게 닿을 수 없다.
    const world = mkWorld([{ pos: { x: 15.5, y: 10.5 }, floor: 1 }]);
    run(world, open20, 0.05);
    expect(world.watcher.moving).toBe(false);
    expect(world.watcher.waitTimer).toBeCloseTo(W.waitSeconds, 9);
    run(world, open20, 0.45);
    expect(world.watcher.waitTimer).toBeCloseTo(0.55, 6);
    // 대기 중 닿을 수 있게 되어도 1초가 지나기 전에는 움직이지 않는다.
    world.players.p1!.floor = 0;
    run(world, open20, 0.45);
    expect(world.watcher.pos).toEqual({ x: 3.5, y: 10.5 });
    expect(world.watcher.moving).toBe(false);
    // 1초가 지나면 재탐색해 움직인다.
    run(world, open20, 0.2);
    expect(world.watcher.moving).toBe(true);
    expect(world.watcher.pos.x).toBeGreaterThan(3.5);
    expect(world.watcher.waitTimer).toBe(0);
  });

  it('재탐색에도 경로가 없으면 다시 1초를 기다린다', () => {
    const world = mkWorld([{ pos: { x: 15.5, y: 10.5 }, floor: 1 }]);
    run(world, open20, 1.05);
    expect(world.watcher.waitTimer).toBeCloseTo(W.waitSeconds, 6);
    expect(world.watcher.moving).toBe(false);
  });

  it('살아 있는 플레이어가 없으면 움직이지 않는다', () => {
    const world = mkWorld([{ alive: false, pos: { x: 15.5, y: 10.5 } }]);
    run(world, open20, 2);
    expect(world.watcher.pos).toEqual({ x: 3.5, y: 10.5 });
    expect(world.watcher.moving).toBe(false);
  });
});

describe('updateWatcher: 소리', () => {
  it('소리 이벤트에 반응하지 않는다', () => {
    const noisy = mkWorld([{ pos: { x: 17.5, y: 10.5 } }]);
    const quiet = mkWorld([{ pos: { x: 17.5, y: 10.5 } }]);
    for (let i = 0; i < 10; i++) {
      noisy.time += DT;
      quiet.time += DT;
      noisy.events = [];
      emitNoise(noisy, 0, { x: 3.5, y: 3.5 }, 40);
      quiet.events = [];
      updateWatcher(noisy, open20, DT);
      updateWatcher(quiet, open20, DT);
    }
    expect(noisy.watcher).toEqual(quiet.watcher);
    expect(noisy.watcher.pos.y).toBeCloseTo(10.5, 6);
  });

  it('플레이어가 없을 때 소리만으로는 움직이지 않는다', () => {
    const world = mkWorld([]);
    emitNoise(world, 0, { x: 15.5, y: 10.5 }, 40);
    updateWatcher(world, open20, 1);
    expect(world.watcher.pos).toEqual({ x: 3.5, y: 10.5 });
  });
});

describe('updateWatcher: 월드 변경 범위', () => {
  it('world.watcher 외에는 바꾸지 않는다', () => {
    const world = mkWorld([{ pos: { x: 17.5, y: 10.5 } }, lighter({ alive: false })]);
    const before = clone({ ...world, watcher: null });
    run(world, open20, 0.5);
    world.time = before.time;
    expect({ ...world, watcher: null }).toEqual(before);
  });
});

describe('watcherContacts', () => {
  it('같은 층에서 거리 < 플레이어 반경 + 0.4인 생존자를 id 순으로 돌려준다', () => {
    const world = mkWorld(
      [
        { pos: { x: 3.5 + REACH - 0.01, y: 10.5 } },
        { pos: { x: 3.5 + REACH, y: 10.5 } },
        { pos: { x: 3.5, y: 10.5 - 0.1 } },
        { pos: { x: 3.5, y: 10.5 }, alive: false },
        { pos: { x: 3.5, y: 10.5 }, floor: 1 },
      ],
      { pos: { x: 3.5, y: 10.5 } },
    );
    expect(watcherContacts(world)).toEqual(['p1', 'p3']);
  });

  it('id 순으로 정렬한다', () => {
    const world = mkWorld([{ pos: { x: 3.5, y: 10.5 } }, { pos: { x: 3.5, y: 10.5 } }]);
    const [a, b] = [world.players.p1!, world.players.p2!];
    world.players = { p2: b, p1: a };
    expect(watcherContacts(world)).toEqual(['p1', 'p2']);
  });

  it('비활성이면 빈 배열', () => {
    expect(watcherContacts(mkWorld([{ pos: { x: 3.5, y: 10.5 } }], { active: false }))).toEqual([]);
  });

  it('정지해 있어도 닿으면 접촉으로 센다', () => {
    const world = mkWorld([{ pos: { x: 3.7, y: 10.5 }, flashlightOn: true, aim: 0 }]);
    expect(watcherContacts(world)).toEqual(['p1']);
  });
});

describe('실제 주차장 맵: 계단 칸에 선 플레이어', () => {
  const parking = getMap('parking-lot');
  /** 가장 길게 위치가 변하지 않은 시간(초)과 접촉까지 걸린 시간(초, 못 닿으면 Infinity)을 잰다. */
  const chase = (world: World, seconds: number): { stillMax: number; touched: number; floors: Set<FloorId> } => {
    const floors = new Set<FloorId>([world.watcher.floor]);
    let still = 0;
    let stillMax = 0;
    let touched = Infinity;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const before = { floor: world.watcher.floor, ...world.watcher.pos };
      run(world, parking, DT);
      floors.add(world.watcher.floor);
      const moved = before.floor !== world.watcher.floor || dist(before, world.watcher.pos) > 1e-9;
      still = moved ? 0 : still + DT;
      stillMax = Math.max(stillMax, still);
      if (watcherContacts(world).length > 0) {
        touched = (i + 1) * DT;
        break;
      }
    }
    return { stillMax, touched, floors };
  };

  it('같은 층 계단 칸에 선 플레이어에게 다가간다', () => {
    const world = mkWorld([{ pos: at(0, 33, 16).pos, floor: 0 }], { floor: 0, pos: at(0, 30, 10).pos });
    const { stillMax, touched, floors } = chase(world, 6);
    expect(stillMax).toBeLessThanOrEqual(2);
    expect(touched).toBeLessThan(4);
    // 계단 칸이 도착지여도 반대 층으로 넘어가 우회하지 않고 걸어서 간다.
    expect([...floors]).toEqual([0]);
  });

  it('다른 층에서 계단 칸에 선 플레이어에게도 다가간다', () => {
    const world = mkWorld([{ pos: at(1, 33, 16).pos, floor: 1 }], { floor: 0, pos: at(0, 30, 10).pos });
    const { stillMax, touched } = chase(world, 12);
    expect(stillMax).toBeLessThanOrEqual(2);
    expect(touched).toBeLessThan(10);
    expect(world.watcher.floor).toBe(1);
  });

  it('시선형이 계단 칸에 서 있어도 멈추지 않는다', () => {
    const world = mkWorld([{ pos: at(0, 40, 10).pos, floor: 0 }], { floor: 1, pos: at(1, 33, 16).pos });
    const { stillMax, touched } = chase(world, 12);
    expect(stillMax).toBeLessThanOrEqual(2);
    expect(touched).toBeLessThan(10);
  });

  it('플레이어가 계단을 오르내려도 시선형이 따라온다', () => {
    const world = mkWorld([{ pos: at(0, 33, 16).pos, floor: 0 }], { floor: 0, pos: at(0, 30, 10).pos });
    run(world, parking, 0.5);
    world.players.p1!.floor = 1;
    const { stillMax, touched } = chase(world, 12);
    expect(stillMax).toBeLessThanOrEqual(2);
    expect(touched).toBeLessThan(10);
  });
});
