import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { dist } from '../src/geometry.ts';
import { emitNoise } from '../src/noise.ts';
import { startRetreat, stalkerContacts, updateStalker } from '../src/monsters/stalker.ts';
import type { MapData } from '../src/map/types.ts';
import type { FloorId, StalkerState, Vec, World } from '../src/types.ts';
import { open20, open20Wall } from './fixtures/maps.ts';
import { makePlayer, makeWorld } from './fixtures/world.ts';

const S = CONFIG.stalker;
const DT = 0.05;

const mkStalker = (partial: Partial<StalkerState> = {}): StalkerState => ({
  id: 's1',
  floor: 0,
  pos: { x: 5.5, y: 10.5 },
  mode: 'patrol',
  targetId: null,
  goal: null,
  timer: 0,
  patrolIndex: 0,
  routeIndex: 0,
  path: [],
  ...partial,
});

/** 플레이어 1명(p1)이 있는 월드. 기본 난이도 보정은 1인(×0.85)이므로 필요하면 playerCount를 바꾼다. */
const mkWorld = (p1: Partial<ReturnType<typeof makePlayer>> = {}, extra: Partial<World> = {}): World => {
  const player = makePlayer({ id: 'p1', pos: { x: 10.5, y: 10.5 }, ...p1 });
  return makeWorld({ players: { p1: player }, playerCount: 2, ...extra });
};

const run = (world: World, map: MapData, s: StalkerState, seconds: number): void => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.events = [];
    updateStalker(world, map, s, DT);
  }
};

describe('emitNoise', () => {
  it('noise 이벤트를 추가하고 위치는 복사본이다', () => {
    const w = mkWorld();
    const pos = { x: 3, y: 4 };
    emitNoise(w, 1, pos, 8);
    pos.x = 99;
    expect(w.events).toEqual([{ type: 'noise', floor: 1, pos: { x: 3, y: 4 }, radius: 8 }]);
  });
});

describe('stalker 소리 감지', () => {
  it('배회 중 소리를 들으면 조사로 전환하고 목표는 소리 위치', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 5.5 } });
    emitNoise(w, 0, { x: 8.5, y: 5.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('investigate');
    expect(s.goal).toEqual({ x: 8.5, y: 5.5 });
    // 조사 속도(×1.0 난이도 2인)로 소리 쪽으로 움직인다.
    expect(s.pos.x).toBeCloseTo(5.5 + S.investigateSpeed * DT, 6);
  });

  it('반경 밖 소리는 무시', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 5.5 } });
    emitNoise(w, 0, { x: 15.5, y: 5.5 }, CONFIG.noise.walk); // 거리 10 > 반경 1.5
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('patrol');
  });

  it('다른 층 소리는 무시', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 5.5 } });
    emitNoise(w, 1, { x: 6.5, y: 5.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('patrol');
  });

  it('여러 소리면 가장 가까운 소리가 목표', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 5.5 } });
    emitNoise(w, 0, { x: 10.5, y: 5.5 }, CONFIG.noise.run);
    emitNoise(w, 0, { x: 5.5, y: 8.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    expect(s.goal).toEqual({ x: 5.5, y: 8.5 });
  });

  it('추격 중에는 소리를 무시', () => {
    const w = mkWorld({ pos: { x: 9.5, y: 10.5 } });
    const s = mkStalker({ mode: 'chase', targetId: 'p1', pos: { x: 5.5, y: 10.5 } });
    emitNoise(w, 0, { x: 5.5, y: 12.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('chase');
    expect(s.targetId).toBe('p1');
  });

  it('조사 목표에 도착해 발견 못 하면 배회', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 5.5 } });
    emitNoise(w, 0, { x: 8.5, y: 5.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    for (let i = 0; i < 40 && s.mode === 'investigate'; i++) {
      w.events = [];
      updateStalker(w, open20, s, DT);
    }
    expect(s.mode).toBe('patrol');
    expect(dist(s.pos, { x: 8.5, y: 5.5 })).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});

describe('stalker 발견', () => {
  it('6타일 안에서 보이면 추격', () => {
    const w = mkWorld({ pos: { x: 10.5, y: 10.5 } }); // 거리 5
    const s = mkStalker();
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('chase');
    expect(s.targetId).toBe('p1');
    expect(s.goal).toEqual({ x: 10.5, y: 10.5 });
  });

  it('6타일 경계(거리 6)는 보이고 6.5는 안 보인다', () => {
    const near = mkWorld({ pos: { x: 11.5, y: 10.5 } });
    const a = mkStalker();
    updateStalker(near, open20, a, DT);
    expect(a.mode).toBe('chase');
    const far = mkWorld({ pos: { x: 12, y: 10.5 } });
    const b = mkStalker();
    updateStalker(far, open20, b, DT);
    expect(b.mode).toBe('patrol');
  });

  it('6타일 안이어도 벽 뒤면 추격하지 않는다', () => {
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 } }); // 벽(x=10) 건너편, 거리 4
    const s = mkStalker({ pos: { x: 8.5, y: 10.5 } });
    updateStalker(w, open20Wall, s, DT);
    expect(s.mode).toBe('patrol');
  });

  it('7타일 밖이라도 손전등에 비춰지면 그 플레이어를 추격', () => {
    // 거리 7: 시야 반경 밖이지만 손전등(사거리 8) 부채꼴 안.
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 }, aim: Math.PI, flashlightOn: true });
    const s = mkStalker({ pos: { x: 5.5, y: 10.5 } });
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('chase');
    expect(s.targetId).toBe('p1');
  });

  it('손전등이 꺼져 있으면 7타일 밖은 발견하지 않는다', () => {
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 }, aim: Math.PI, flashlightOn: false });
    const s = mkStalker({ pos: { x: 5.5, y: 10.5 } });
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('patrol');
  });

  it('여러 명이면 가장 가까운 플레이어가 대상(동률이면 id가 작은 쪽)', () => {
    const w = makeWorld({
      playerCount: 3,
      players: {
        p1: makePlayer({ id: 'p1', pos: { x: 5.5, y: 14.5 } }), // 거리 4
        p2: makePlayer({ id: 'p2', pos: { x: 8.5, y: 10.5 } }), // 거리 3
        p3: makePlayer({ id: 'p3', pos: { x: 2.5, y: 10.5 } }), // 거리 3
      },
    });
    const s = mkStalker();
    updateStalker(w, open20, s, DT);
    expect(s.targetId).toBe('p2');
  });

  it('유령(alive=false)은 발견하지 않는다', () => {
    const w = mkWorld({ pos: { x: 8.5, y: 10.5 }, alive: false });
    const s = mkStalker();
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('patrol');
  });

  it('다른 층 플레이어는 발견하지 않는다', () => {
    const w = mkWorld({ pos: { x: 7.5, y: 10.5 }, floor: 1, flashlightOn: true, aim: Math.PI });
    const s = mkStalker();
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('patrol');
    expect(s.targetId).toBeNull();
  });
});

describe('stalker 추격과 수색', () => {
  it('추격 대상이 5초 시야 밖이면 수색, 수색 5초 후 배회', () => {
    // 대상이 벽 뒤로 이동해 보이지 않는다. 마지막 본 지점은 goal에 남는다.
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 } });
    const s = mkStalker({ mode: 'chase', targetId: 'p1', pos: { x: 8.5, y: 10.5 }, goal: { x: 7.5, y: 10.5 } });
    run(w, open20Wall, s, 4.9);
    expect(s.mode).toBe('chase');
    expect(s.timer).toBeCloseTo(4.9, 6);
    run(w, open20Wall, s, 0.15);
    expect(s.mode).toBe('search');
    expect(s.targetId).toBeNull();
    expect(s.timer).toBeCloseTo(S.searchSeconds - DT, 6); // 전환 다음 틱에 한 번 줄었다
    expect(s.goal).toEqual({ x: 7.5, y: 10.5 }); // 마지막으로 본 지점
    run(w, open20Wall, s, 4.9);
    expect(s.mode).toBe('search');
    run(w, open20Wall, s, 0.15);
    expect(s.mode).toBe('patrol');
  });

  it('시야가 잠깐 끊겼다가 다시 보이면 타이머가 초기화', () => {
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 } });
    const s = mkStalker({ mode: 'chase', targetId: 'p1', pos: { x: 8.5, y: 10.5 }, goal: { x: 7.5, y: 10.5 } });
    run(w, open20Wall, s, 3);
    expect(s.timer).toBeCloseTo(3, 6);
    w.players.p1!.pos = { x: 8.5, y: 6.5 }; // 벽 위쪽 열린 곳으로 나와서 보이는 거리
    s.pos = { x: 8.5, y: 3.5 };
    updateStalker(w, open20Wall, s, DT);
    expect(s.mode).toBe('chase');
    expect(s.timer).toBe(0);
    expect(s.goal).toEqual({ x: 8.5, y: 6.5 });
  });

  it('수색 중 발견하면 추격', () => {
    const w = mkWorld({ pos: { x: 8.5, y: 10.5 } });
    const s = mkStalker({ mode: 'search', goal: { x: 5.5, y: 10.5 }, timer: 3 });
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('chase');
    expect(s.targetId).toBe('p1');
  });

  it('추격 대상이 사라져도 다른 플레이어가 보이면 그쪽으로 대상 변경', () => {
    const w = makeWorld({
      playerCount: 2,
      players: {
        p1: makePlayer({ id: 'p1', pos: { x: 18.5, y: 18.5 } }),
        p2: makePlayer({ id: 'p2', pos: { x: 8.5, y: 10.5 } }),
      },
    });
    const s = mkStalker({ mode: 'chase', targetId: 'p1', timer: 2, goal: { x: 18.5, y: 18.5 } });
    updateStalker(w, open20, s, DT);
    expect(s.targetId).toBe('p2');
    expect(s.timer).toBe(0);
  });

  it('배회 경로를 따라 이동하고 도착하면 다음 지점으로 넘어간다', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 3.5, y: 3.5 } });
    // 지점0(3.5,3.5)에 이미 도착: 다음 지점으로 인덱스가 넘어간다.
    updateStalker(w, open20Wall, s, DT);
    expect(s.patrolIndex).toBe(1);
    run(w, open20Wall, s, 1);
    expect(s.pos.x).toBeGreaterThan(3.5 + 2);
    run(w, open20Wall, s, 1.5); // 5타일 / 2.5 = 2초에 도착
    expect(s.patrolIndex).toBe(0); // (8.5,3.5) 도착 후 순환
  });
});

describe('stalker 속도', () => {
  const chaseRun = (playerCount: number, lightsHalved: boolean): number => {
    const w = mkWorld({ pos: { x: 9.5, y: 10.5 } }, { playerCount });
    w.round.lightsHalved = lightsHalved;
    const s = mkStalker({ mode: 'chase', targetId: 'p1', pos: { x: 3.5, y: 10.5 }, goal: { x: 9.5, y: 10.5 } });
    run(w, open20, s, 1);
    expect(s.mode).toBe('chase');
    return s.pos.x - 3.5;
  };

  it('추격 속도 4.5, 1인 보정 0.85, 03:00 이후 1.1배', () => {
    expect(chaseRun(2, false)).toBeCloseTo(4.5, 6);
    expect(chaseRun(1, false)).toBeCloseTo(4.5 * 0.85, 6);
    expect(chaseRun(2, true)).toBeCloseTo(4.5 * 1.1, 6);
    expect(chaseRun(1, true)).toBeCloseTo(4.5 * 0.85 * 1.1, 6); // 곱해진다
  });

  it('배회 2.5, 조사 3.5', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } }, { playerCount: 2 });
    const patrol = mkStalker({ pos: { x: 6.5, y: 10.5 }, goal: { x: 15.5, y: 10.5 } });
    const map: MapData = { ...open20, patrolRoutes: [{ floor: 0, points: [{ x: 15.5, y: 10.5 }] }, open20.patrolRoutes[1]!] };
    run(w, map, patrol, 1);
    expect(patrol.pos.x - 6.5).toBeCloseTo(2.5, 6);
    const inv = mkStalker({ mode: 'investigate', pos: { x: 6.5, y: 10.5 }, goal: { x: 15.5, y: 10.5 } });
    run(w, open20, inv, 1);
    expect(inv.pos.x - 6.5).toBeCloseTo(3.5, 6);
  });

  it('벽을 뚫지 않고 경로를 돌아간다', () => {
    const w = mkWorld({ pos: { x: 12.5, y: 10.5 } });
    const s = mkStalker({ mode: 'chase', targetId: 'p1', pos: { x: 8.5, y: 10.5 }, goal: { x: 12.5, y: 10.5 } });
    run(w, open20Wall, s, 1);
    expect(s.pos.x).toBeLessThan(10 - S.radius + 1e-6);
    expect(s.path.length).toBeGreaterThan(0);
  });
});

describe('stalker 접촉과 후퇴', () => {
  it('stalkerContacts는 같은 층, 거리 < 0.35+0.4인 생존자 id를 id순으로 돌려준다', () => {
    const w = makeWorld({
      playerCount: 5,
      players: {
        p3: makePlayer({ id: 'p3', pos: { x: 5.5, y: 10.9 } }),
        p1: makePlayer({ id: 'p1', pos: { x: 5.9, y: 10.5 } }),
        p2: makePlayer({ id: 'p2', pos: { x: 5.5 + 0.75, y: 10.5 } }), // 정확히 0.75: 닿지 않음
        p4: makePlayer({ id: 'p4', pos: { x: 5.6, y: 10.5 }, floor: 1 as FloorId }),
        p5: makePlayer({ id: 'p5', pos: { x: 5.6, y: 10.5 }, alive: false }),
      },
    });
    expect(stalkerContacts(w, mkStalker())).toEqual(['p1', 'p3']);
  });

  it('startRetreat는 후퇴 상태, 타이머 3초, 목표 = 맞은 플레이어 위치 복사본', () => {
    const s = mkStalker({ mode: 'chase', targetId: 'p1', path: [{ x: 1, y: 1 }] });
    const from = { x: 6.5, y: 10.5 };
    startRetreat(s, from);
    from.x = 99;
    expect(s.mode).toBe('retreat');
    expect(s.timer).toBe(S.retreatSeconds);
    expect(s.goal).toEqual({ x: 6.5, y: 10.5 });
    expect(s.path).toEqual([]);
  });

  it('후퇴 중에는 플레이어 반대 방향으로 순찰 속도로 물러나고 발견·소리를 무시', () => {
    const w = mkWorld({ pos: { x: 6.5, y: 10.5 } });
    const s = mkStalker({ pos: { x: 5.5, y: 10.5 } });
    startRetreat(s, { x: 6.5, y: 10.5 });
    emitNoise(w, 0, { x: 5.5, y: 10.5 }, CONFIG.noise.run);
    updateStalker(w, open20, s, DT);
    expect(s.mode).toBe('retreat');
    expect(s.pos.x).toBeCloseTo(5.5 - S.patrolSpeed * DT, 6);
    expect(s.pos.y).toBeCloseTo(10.5, 6);
    run(w, open20, s, 0.5);
    expect(s.mode).toBe('retreat');
  });

  it('후퇴 3초 후 수색', () => {
    const w = mkWorld({ pos: { x: 18.5, y: 18.5 } });
    const s = mkStalker({ pos: { x: 8.5, y: 10.5 } });
    startRetreat(s, { x: 9.5, y: 10.5 });
    run(w, open20, s, 2.95);
    expect(s.mode).toBe('retreat');
    run(w, open20, s, 0.05); // 합계 정확히 3초 = 60틱째에 수색으로
    expect(s.mode).toBe('search');
    expect(s.timer).toBeCloseTo(S.searchSeconds, 6); // 후퇴가 끝난 틱에 막 시작
    expect(s.goal).toEqual(s.pos);
    expect(s.targetId).toBeNull();
    // 3초간 7.5타일 / 벽 때문에 막히면 더 짧다. 시작(8.5)에서 왼쪽으로 물러났다.
    expect(s.pos.x).toBeLessThan(8.5);
  });

  it('후퇴는 벽에서 멈춘다(벽 안으로 들어가지 않는다)', () => {
    const w = mkWorld({ pos: { x: 6.5, y: 10.5 } });
    const s = mkStalker({ pos: { x: 3.5, y: 10.5 } });
    startRetreat(s, { x: 4.5, y: 10.5 });
    run(w, open20, s, 3);
    expect(s.pos.x).toBeGreaterThanOrEqual(1 + S.radius - 1e-6);
  });
});

describe('stalker 순수성', () => {
  it('world와 map을 변경하지 않는다(이벤트 포함)', () => {
    const w = mkWorld({ pos: { x: 8.5, y: 10.5 } });
    emitNoise(w, 0, { x: 5.5, y: 10.5 }, 4);
    const before = JSON.parse(JSON.stringify(w));
    const mapBefore = JSON.parse(JSON.stringify(open20));
    updateStalker(w, open20, mkStalker(), DT);
    expect(w).toEqual(before);
    expect(open20).toEqual(mapBefore);
  });
});
