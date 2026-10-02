import { describe, expect, it } from 'vitest';
import { CONFIG } from '@bh/shared';
import type { FloorId, ItemState, LightState, MapData, Vec } from '@bh/shared';
import { dangerDistance, isLightLit, lightSources, litAreas, visibleEntities } from '../src/render/visibility.ts';
import type { MonsterView, RenderPlayer, RenderSnapshot } from '../src/render/visibility.ts';

/**
 * 20×10 방. x=6 열의 y=1..3에 벽이 있어 (2.5, 2.5)에서 오른쪽을 보면 막힌다. 아래쪽(y ≥ 4)은 트였다.
 * 트럭 구역은 오른쪽 위 (15..19, 1..3). 트럭 빛(반경 6)은 아래쪽 판정 지점들에 닿지 않는다.
 */
const rows = [
  '####################',
  '#.....#............#',
  '#.....#............#',
  '#.....#............#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];
const floorData = { width: 20, height: 10, rows };
const map = {
  id: 'vis', floors: [floorData, floorData], truckZone: { x: 15, y: 1, w: 4, h: 2 }, spawns: [], itemSlots: [],
  patrolRoutes: [], lights: [], stairs: [], zones: [],
} as unknown as MapData;

const player = (id: string, p: Partial<RenderPlayer> = {}): RenderPlayer => ({
  id, name: id, pos: { x: 2.5, y: 6.5 }, floor: 0, aim: 0, flashlightOn: false, battery: 180, hp: 2,
  stamina: CONFIG.player.staminaMax, alive: true, inventory: [], selectedSlot: 0, lastSeq: 0, interactHeld: 0,
  prevInteract: false, onStairs: false, exhausted: false, connected: true,
  cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 0, colorIndex: 0, ...p,
});
const monster = (id: string, pos: Vec, floor: FloorId = 0, p: Partial<MonsterView> = {}): MonsterView => ({
  id, kind: 'stalker', pos, floor, active: true, ...p,
});
const item = (id: string, pos: Vec, floor: FloorId = 0, p: Partial<ItemState> = {}): ItemState => ({
  id, kind: '고철', value: 10, weight: 2, pos, floor, carriedBy: null, loaded: false, ...p,
});
const light = (id: string, pos: Vec, p: Partial<LightState> = {}): LightState => ({
  id, floor: 0, pos, radius: 3, on: true, flickering: false, flickerUntil: 0, ...p,
});

function snap(self: RenderPlayer, rest: Partial<RenderSnapshot> = {}): RenderSnapshot {
  return {
    selfId: self.id, self, players: [self], items: [], monsters: [], lights: [], time: 10, pings: [], ...rest,
  };
}
const ids = (xs: { id: string }[]): string[] => xs.map((x) => x.id).sort();

describe('visibleEntities', () => {
  it('생존자에게는 빛 밖의 몬스터가 보이지 않는다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 } });
    const s = snap(me, {
      monsters: [monster('far', { x: 10.5, y: 6.5 }), monster('near', { x: 3.5, y: 6.5 })],
      items: [item('dark', { x: 9.5, y: 7.5 })],
    });
    const v = visibleEntities(s, map);
    // 주변 빛(1.5타일) 안의 몬스터만 보인다
    expect(ids(v.monsters)).toEqual(['near']);
    expect(v.items).toEqual([]);
  });

  it('손전등 부채꼴 안의 몬스터는 보인다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 }, flashlightOn: true, aim: 0 });
    const s = snap(me, {
      monsters: [
        monster('ahead', { x: 8.5, y: 6.5 }),         // 6타일 앞
        monster('behind', { x: 0.5 + 0.2, y: 4.5 }),  // 부채꼴 밖(뒤쪽 위)
        monster('tooFar', { x: 12.5, y: 6.5 }),       // 사거리 8 밖
      ],
      items: [item('lit', { x: 7.5, y: 7.0 })],
    });
    const v = visibleEntities(s, map);
    expect(ids(v.monsters)).toEqual(['ahead']);
    expect(ids(v.items)).toEqual(['lit']);
  });

  it('벽 뒤의 몬스터는 손전등 사거리 안이어도 보이지 않는다', () => {
    const me = player('me', { pos: { x: 2.5, y: 2.5 }, flashlightOn: true, aim: 0 });
    const s = snap(me, { monsters: [monster('front', { x: 5.0, y: 2.5 }), monster('hidden', { x: 8.5, y: 2.5 })] });
    expect(ids(visibleEntities(s, map).monsters)).toEqual(['front']);
  });

  it('다른 플레이어의 손전등과 켜진 고정 조명도 몬스터를 드러낸다', () => {
    const me = player('me', { pos: { x: 2.5, y: 8.5 } });
    const mate = player('mate', { pos: { x: 10.5, y: 4.5 }, flashlightOn: true, aim: 0 });
    const s = snap(me, {
      players: [me, mate],
      lights: [light('lamp', { x: 4.5, y: 4.5 }, { radius: 2 })],
      monsters: [monster('byMate', { x: 15.5, y: 4.5 }), monster('byLamp', { x: 5.0, y: 4.5 }), monster('dark', { x: 12.5, y: 8.5 })],
    });
    expect(ids(visibleEntities(s, map).monsters)).toEqual(['byLamp', 'byMate']);
  });

  it('다른 층 엔티티는 보이지 않는다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 }, flashlightOn: true, aim: 0 });
    const other = player('other', { pos: { x: 3.0, y: 6.5 }, floor: 1 });
    const s = snap(me, {
      players: [me, other],
      monsters: [monster('m1', { x: 3.0, y: 6.5 }, 1), monster('m0', { x: 3.0, y: 6.5 }, 0)],
      items: [item('i1', { x: 4.5, y: 6.5 }, 1), item('i0', { x: 4.5, y: 6.5 }, 0)],
    });
    const v = visibleEntities(s, map);
    expect(ids(v.monsters)).toEqual(['m0']);
    expect(ids(v.items)).toEqual(['i0']);
    expect(ids(v.players)).toEqual(['me']);
  });

  it('유령 시점에서도 다른 층 엔티티는 보이지 않는다', () => {
    const me = player('me', { alive: false, floor: 0 });
    const s = snap(me, {
      monsters: [monster('m1', { x: 10.5, y: 6.5 }, 1)],
      items: [item('i1', { x: 10.5, y: 6.5 }, 1)],
      players: [me, player('p1', { floor: 1 })],
    });
    const v = visibleEntities(s, map);
    expect(v.monsters).toEqual([]);
    expect(v.items).toEqual([]);
    expect(ids(v.players)).toEqual(['me']);
  });

  it('생존자에게 유령은 보이지 않고 유령끼리는 보인다', () => {
    const living = player('living', { pos: { x: 2.5, y: 6.5 } });
    const ghostA = player('ghostA', { pos: { x: 3.0, y: 6.5 }, alive: false });
    const ghostB = player('ghostB', { pos: { x: 12.5, y: 7.5 }, alive: false });
    const mate = player('mate', { pos: { x: 15.5, y: 2.5 } });
    const all = [living, ghostA, ghostB, mate];

    const fromLiving = visibleEntities(snap(living, { players: all }), map);
    expect(ids(fromLiving.players)).toEqual(['living', 'mate']);

    const fromGhost = visibleEntities(snap(ghostA, { players: all }), map);
    expect(ids(fromGhost.players)).toEqual(['ghostA', 'ghostB', 'living', 'mate']);
  });

  it('유령 시점에서는 어둠 속 몬스터도 보인다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 }, alive: false });
    const s = snap(me, {
      monsters: [monster('dark', { x: 17.5, y: 2.5 }), monster('watcher', { x: 12.5, y: 8.5 }, 0, { kind: 'watcher' })],
      items: [item('darkItem', { x: 16.5, y: 8.5 })],
    });
    const v = visibleEntities(s, map);
    expect(ids(v.monsters)).toEqual(['dark', 'watcher']);
    expect(ids(v.items)).toEqual(['darkItem']);
  });

  it('비활성 몬스터(등장 전 시선형)는 누구에게도 보이지 않는다', () => {
    const ghost = player('g', { alive: false });
    const s = snap(ghost, { monsters: [monster('w', { x: 3.0, y: 6.5 }, 0, { kind: 'watcher', active: false })] });
    expect(visibleEntities(s, map).monsters).toEqual([]);
  });

  it('들고 있거나 실은 폐품은 그리지 않는다(빛 안이거나 유령이어도)', () => {
    for (const alive of [true, false]) {
      const me = player('me', { alive });
      const s = snap(me, {
        items: [
          item('carried', { x: 3.0, y: 6.5 }, 0, { carriedBy: 'me' }),
          item('loaded', { x: 3.0, y: 6.5 }, 0, { loaded: true }),
          item('floor', { x: 3.0, y: 6.5 }),
        ],
      });
      expect(ids(visibleEntities(s, map).items)).toEqual(['floor']);
    }
  });

  it('미리 계산한 빛 영역을 넘기면 그것으로 판정한다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 } });
    const s = snap(me, { monsters: [monster('far', { x: 10.5, y: 6.5 })] });
    const areas = litAreas(s, map).concat([{ source: { pos: { x: 10.5, y: 6.5 }, radius: 1 }, poly: [{ x: 9.5, y: 5.5 }, { x: 11.5, y: 5.5 }, { x: 11.5, y: 7.5 }, { x: 9.5, y: 7.5 }] }]);
    expect(ids(visibleEntities(s, map, areas).monsters)).toEqual(['far']);
  });
});

describe('lightSources', () => {
  it('생존자 주변 빛(1.5타일)과 켜진 손전등(60°, 8타일)', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 }, flashlightOn: true, aim: 1 });
    const src = lightSources(snap(me), map);
    expect(src).toContainEqual(expect.objectContaining({ pos: me.pos, radius: CONFIG.player.ambientRadius }));
    expect(src).toContainEqual(expect.objectContaining({
      pos: me.pos, radius: CONFIG.flashlight.range, arc: { aim: 1, angle: CONFIG.flashlight.angle },
    }));
  });

  it('손전등이 꺼져 있으면 부채꼴이 없다', () => {
    const src = lightSources(snap(player('me')), map);
    expect(src.filter((s) => s.arc)).toEqual([]);
  });

  it('유령과 다른 층 플레이어는 빛을 내지 않는다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 } });
    const ghost = player('ghost', { pos: { x: 8.5, y: 6.5 }, alive: false, flashlightOn: true });
    const below = player('below', { pos: { x: 12.5, y: 6.5 }, floor: 1, flashlightOn: true });
    const src = lightSources(snap(me, { players: [me, ghost, below] }), map);
    const xs = src.map((s) => s.pos.x);
    expect(xs).not.toContain(8.5);
    expect(xs).not.toContain(12.5);
  });

  it('유령 시점: 같은 층 생존자의 빛을 보여 준다', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 }, alive: false });
    const mate = player('mate', { pos: { x: 8.5, y: 6.5 }, flashlightOn: true });
    const src = lightSources(snap(me, { players: [me, mate] }), map);
    expect(src.map((s) => s.pos.x)).not.toContain(2.5);
    expect(src.filter((s) => s.pos.x === 8.5)).toHaveLength(2);
  });

  it('고정 조명: 같은 층에서 켜진 것만', () => {
    const me = player('me');
    const lights = [
      light('on', { x: 4.5, y: 4.5 }),
      light('off', { x: 8.5, y: 4.5 }, { on: false }),
      light('other', { x: 12.5, y: 4.5 }, { floor: 1 }),
    ];
    const src = lightSources(snap(me, { lights }), map);
    expect(src).toContainEqual(expect.objectContaining({ pos: { x: 4.5, y: 4.5 }, radius: 3 }));
    const xs = src.map((s) => s.pos.x);
    expect(xs).not.toContain(8.5);
    expect(xs).not.toContain(12.5);
  });

  it('트럭 구역 빛은 B1에서만', () => {
    const zone = map.truckZone;
    const center = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
    const b1 = lightSources(snap(player('me', { floor: 0 })), map);
    expect(b1).toContainEqual(expect.objectContaining({ pos: center, radius: CONFIG.fx.truckLightRadius }));
    const b2 = lightSources(snap(player('me', { floor: 1 })), map);
    expect(b2.map((s) => s.pos)).not.toContainEqual(center);
  });

  it('깜빡이는 조명은 Math.floor(time*12) % 2일 때만 켜진다', () => {
    const me = player('me');
    const blinking = light('blink', { x: 4.5, y: 4.5 }, { flickering: true });
    const at = (time: number) => lightSources(snap(me, { lights: [blinking], time }), map).some((s) => s.pos.x === 4.5);
    expect(at(1 / 12 + 0.01)).toBe(true);   // floor = 1
    expect(at(2 / 12 + 0.01)).toBe(false);  // floor = 2
    expect(at(3 / 12 + 0.01)).toBe(true);
  });

  it('유령이 깜빡이게 한 조명(flickerUntil)은 그 시각까지 같은 패턴, 이후 계속 켜짐', () => {
    const me = player('me');
    const l = light('ghosted', { x: 4.5, y: 4.5 }, { flickerUntil: 20 });
    expect(isLightLit(l, 2 / 12 + 0.01)).toBe(false);
    expect(isLightLit(l, 1 / 12 + 0.01)).toBe(true);
    expect(isLightLit(l, 20.5 + 2 / 12)).toBe(true);
    const src = lightSources(snap(me, { lights: [l], time: 10 + 2 / 12 + 0.01 }), map);
    expect(src.some((s) => s.pos.x === 4.5)).toBe(false);
    expect(isLightLit({ ...l, on: false }, 30)).toBe(false);
  });
});

describe('litAreas', () => {
  it('보이는 영역 밖 광원은 계산하지 않는다(여유 포함)', () => {
    const me = player('me', { pos: { x: 2.5, y: 6.5 } });
    const lights = [light('near', { x: 4.5, y: 4.5 }), light('far', { x: 17.5, y: 2.5 }, { radius: 2 })];
    const s = snap(me, { lights });
    const all = litAreas(s, map);
    const culled = litAreas(s, map, { x: 0, y: 3, w: 8, h: 7 });
    expect(all.some((a) => a.source.pos.x === 17.5)).toBe(true);
    expect(culled.some((a) => a.source.pos.x === 17.5)).toBe(false);
    expect(culled.some((a) => a.source.pos.x === 4.5)).toBe(true);
  });

  it('고정 광원 다각형은 벽에 막힌다', () => {
    const me = player('me', { pos: { x: 2.5, y: 8.5 } });
    const s = snap(me, { lights: [light('room', { x: 3.5, y: 2.5 }, { radius: 8 })] });
    const area = litAreas(s, map).find((a) => a.source.pos.x === 3.5)!;
    // x=6 벽(y 1..3) 너머로는 넘어가지 않는다
    const beyond = area.poly.filter((p) => p.y < 3.5 && p.x > 6 + 1e-6);
    expect(beyond).toEqual([]);
  });
});

describe('dangerDistance', () => {
  const me = player('me');
  it('위험 거리 안의 같은 층 활성 몬스터 중 가장 가까운 거리', () => {
    const s = snap(me, { monsters: [monster('a', { x: 6.5, y: 6.5 }), monster('b', { x: 4.5, y: 6.5 }), monster('c', { x: 40, y: 6.5 })] });
    expect(dangerDistance(s)).toBeCloseTo(2);
  });
  it('다른 층·비활성·먼 몬스터는 무시하고, 없으면 null', () => {
    const s = snap(me, {
      monsters: [monster('floor', { x: 3.5, y: 6.5 }, 1), monster('off', { x: 3.5, y: 6.5 }, 0, { active: false }), monster('far', { x: 20, y: 6.5 })],
    });
    expect(dangerDistance(s)).toBeNull();
  });
});
