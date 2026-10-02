import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '@bh/shared';
import type { FloorId, LightState, Vec } from '@bh/shared';
import { createAudioDirector } from '../src/audio/director.ts';
import type { AudioDirector } from '../src/audio/director.ts';
import type { Located } from '../src/audio/spatial.ts';
import type { MonsterView, RenderPlayer, RenderSnapshot } from '../src/render/visibility.ts';

type Call = { fn: 'play' | 'setLoop' | 'setListener'; args: unknown[] };
function fakeAudio() {
  const calls: Call[] = [];
  return {
    calls,
    play: (...args: unknown[]) => { calls.push({ fn: 'play', args }); },
    setLoop: (...args: unknown[]) => { calls.push({ fn: 'setLoop', args }); },
    setListener: (...args: unknown[]) => { calls.push({ fn: 'setListener', args }); },
    plays: (kind: string) => calls.filter((c) => c.fn === 'play' && c.args[0] === kind),
    lastLoop: (kind: string) => [...calls].reverse().find((c) => c.fn === 'setLoop' && c.args[0] === kind),
  };
}

const me = (p: Partial<RenderPlayer> = {}): RenderPlayer => ({
  id: 'me', name: 'me', pos: { x: 10, y: 10 }, floor: 0, aim: 0, flashlightOn: false, battery: 180, hp: 2, stamina: 5, alive: true,
  inventory: [], selectedSlot: 0, lastSeq: 0, interactHeld: 0, prevInteract: false, onStairs: false, exhausted: false, connected: true,
  cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 0, colorIndex: 0, ...p,
});
const monster = (id: string, pos: Vec, p: Partial<MonsterView> = {}): MonsterView => ({
  id, kind: 'stalker', pos, floor: 0, active: true, ...p,
});
const light = (id: string, pos: Vec, p: Partial<LightState> = {}): LightState => ({
  id, floor: 0, pos, radius: 3, on: true, flickering: true, flickerUntil: 0, ...p,
});
const snap = (rest: Partial<RenderSnapshot> = {}, self = me()): RenderSnapshot => ({
  selfId: 'me', self, players: [self], items: [], monsters: [], lights: [], time: 0, pings: [], ...rest,
});

describe('audio director', () => {
  let audio: ReturnType<typeof fakeAudio>;
  let d: AudioDirector;
  beforeEach(() => { audio = fakeAudio(); d = createAudioDirector(audio); });

  it('시작하면 배경 웅웅거림을 켜고, 멈추면 끈다', () => {
    expect(audio.lastLoop('ambient')?.args).toEqual(['ambient', true]);
    d.stop();
    expect(audio.lastLoop('ambient')?.args).toEqual(['ambient', false]);
  });

  it('매 프레임 듣는 이 위치를 갱신한다', () => {
    d.update(snap(), 0.016);
    const c = audio.calls.find((x) => x.fn === 'setListener');
    expect(c?.args[0]).toEqual({ pos: { x: 10, y: 10 }, floor: 0 });
  });

  describe('추적형 발소리', () => {
    it('움직이는 동안 0.5초 간격으로 울린다', () => {
      const dt = 0.1;
      for (let i = 0; i < 20; i++) {
        d.update(snap({ monsters: [monster('s', { x: 20 + i * 0.3, y: 5 })] }), dt);
      }
      // 첫 프레임은 이동 여부를 모르고, 이후 19프레임(1.9초) 동안 이동 → 첫 발소리 + 0.5초마다
      const n = audio.plays('stalkerStep').length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      expect((audio.plays('stalkerStep')[0]!.args[1] as Located).pos.x).toBeGreaterThan(20);
    });

    it('멈춰 있으면 울리지 않는다', () => {
      for (let i = 0; i < 20; i++) d.update(snap({ monsters: [monster('s', { x: 20, y: 5 })] }), 0.1);
      expect(audio.plays('stalkerStep')).toHaveLength(0);
    });

    it('비활성이면 울리지 않는다', () => {
      for (let i = 0; i < 5; i++) d.update(snap({ monsters: [monster('s', { x: 20 + i, y: 5 }, { active: false })] }), 0.1);
      expect(audio.plays('stalkerStep')).toHaveLength(0);
    });
  });

  describe('시선형 끌리는 소리', () => {
    const w = (p: Partial<MonsterView>): MonsterView => monster('w', { x: 14, y: 10 }, { kind: 'watcher', ...p });
    it('moving && !frozen이고 같은 층이면 켠다', () => {
      d.update(snap({ monsters: [w({ moving: true, frozen: false })] }), 0.016);
      expect(audio.lastLoop('watcherDrag')?.args).toEqual(['watcherDrag', true, { pos: { x: 14, y: 10 }, floor: 0 }]);
    });
    it.each([
      ['멈춤', { moving: false, frozen: false }],
      ['얼어붙음', { moving: true, frozen: true }],
      ['다른 층', { moving: true, frozen: false, floor: 1 as FloorId }],
      ['비활성', { moving: true, frozen: false, active: false }],
    ])('%s이면 끈다', (_name, p) => {
      d.update(snap({ monsters: [w(p)] }), 0.016);
      expect(audio.lastLoop('watcherDrag')?.args[1]).toBe(false);
    });
  });

  describe('형광등 지직', () => {
    const hz = CONFIG.fx.flickerBlinkHz;
    /** 빛나는 구간(floor(t*hz)%2 === 1)의 시작 시각. */
    const litAt = (k: number): number => (2 * k + 1) / hz + 1e-6;
    const darkAt = (k: number): number => (2 * k) / hz + 1e-6;

    it('깜빡이는 가까운 조명이 빛나는 쪽으로 바뀔 때 울린다', () => {
      const l = light('L', { x: 12, y: 10 });
      d.update(snap({ lights: [l], time: darkAt(5) }), 0.016);
      expect(audio.plays('buzz')).toHaveLength(0);
      d.update(snap({ lights: [l], time: litAt(5) }), 0.016);
      expect(audio.plays('buzz')).toHaveLength(1);
      expect((audio.plays('buzz')[0]!.args[1] as Located).pos).toEqual({ x: 12, y: 10 });
    });

    it('깜빡이지 않거나 멀거나 다른 층이면 울리지 않는다', () => {
      const lights = [
        light('steady', { x: 12, y: 10 }, { flickering: false }),
        light('far', { x: 12 + CONFIG.audio.buzzRange + 1, y: 10 }),
        light('other', { x: 12, y: 10 }, { floor: 1 }),
      ];
      d.update(snap({ lights, time: darkAt(5) }), 0.1);
      d.update(snap({ lights, time: litAt(5) }), 0.1);
      expect(audio.plays('buzz')).toHaveLength(0);
    });

    it('유령이 깜빡이게 한 조명(flickerUntil)도 울린다', () => {
      const l = light('G', { x: 12, y: 10 }, { flickering: false, flickerUntil: 100 });
      d.update(snap({ lights: [l], time: darkAt(5) }), 0.1);
      d.update(snap({ lights: [l], time: litAt(5) }), 0.1);
      expect(audio.plays('buzz')).toHaveLength(1);
    });
  });

  describe('심장 소리', () => {
    it('위험 거리 안에서 가까울수록 빠르게 뛴다', () => {
      const count = (x: number): number => {
        const a = fakeAudio();
        const dir = createAudioDirector(a);
        for (let i = 0; i < 100; i++) dir.update(snap({ monsters: [monster('s', { x, y: 10 })] }), 0.1);
        return a.plays('heartbeat').length;
      };
      const near = count(10 + 1);
      const edge = count(10 + CONFIG.fx.dangerDistance - 0.1);
      expect(near).toBeGreaterThan(edge);
      expect(edge).toBeGreaterThan(0);
    });
    it('멀리 있거나 유령이면 뛰지 않는다', () => {
      for (let i = 0; i < 30; i++) d.update(snap({ monsters: [monster('s', { x: 40, y: 10 })] }), 0.1);
      for (let i = 0; i < 30; i++) d.update(snap({ monsters: [monster('s', { x: 11, y: 10 })] }, me({ alive: false })), 0.1);
      expect(audio.plays('heartbeat')).toHaveLength(0);
    });
  });

  describe('소음 이벤트', () => {
    const run = (pos: Vec, floor: FloorId = 0) => ({ floor, pos, radius: CONFIG.noise.run });
    it('동료가 뛰는 소음만 울린다(내 소음·걷기·떨어뜨리기 제외)', () => {
      d.update(snap(), 1);
      d.onNoise(run({ x: 10.2, y: 10 })); // 내 것
      d.onNoise({ floor: 0, pos: { x: 15, y: 10 }, radius: CONFIG.noise.walk });
      d.onNoise({ floor: 0, pos: { x: 15, y: 10 }, radius: CONFIG.noise.drop });
      expect(audio.plays('teammateRun')).toHaveLength(0);
      d.onNoise(run({ x: 15, y: 10 }));
      expect(audio.plays('teammateRun')).toHaveLength(1);
    });
    it('틱마다 오는 소음은 최소 간격으로 거른다', () => {
      d.update(snap(), 1);
      d.onNoise(run({ x: 15, y: 10 }));
      d.update(snap(), 0.05);
      d.onNoise(run({ x: 15, y: 10 }));
      expect(audio.plays('teammateRun')).toHaveLength(1);
      d.update(snap(), CONFIG.audio.teammateRunInterval);
      d.onNoise(run({ x: 15, y: 10 }));
      expect(audio.plays('teammateRun')).toHaveLength(2);
    });
  });

  it('소지품이 늘 때만 줍는 소리(처음 값은 기준)', () => {
    d.onInventory(1);
    expect(audio.plays('pickup')).toHaveLength(0);
    d.onInventory(2);
    expect(audio.plays('pickup')).toHaveLength(1);
    d.onInventory(1);
    d.onInventory(1);
    expect(audio.plays('pickup')).toHaveLength(1);
  });

  it('경적', () => {
    d.onHorn();
    expect(audio.plays('horn')).toHaveLength(1);
  });
});
