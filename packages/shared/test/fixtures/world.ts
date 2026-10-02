import { CONFIG } from '../../src/config.ts';
import type { ItemState, PlayerInput, PlayerState, World } from '../../src/types.ts';

/** 테스트용 PlayerState. 기본값은 B1 (1.5, 1.5)에 선 살아 있는 플레이어. */
export function makePlayer(partial: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'tester',
    pos: { x: 1.5, y: 1.5 },
    floor: 0,
    aim: 0,
    flashlightOn: false,
    battery: 180,
    hp: CONFIG.player.hp,
    stamina: CONFIG.player.staminaMax,
    alive: true,
    inventory: [],
    selectedSlot: 0,
    lastSeq: 0,
    interactHeld: 0,
    prevInteract: false,
    onStairs: false,
    exhausted: false,
    connected: true,
    cooldowns: { flicker: 0, ping: 0, chat: 0 },
    carriedTotal: 0,
    ...partial,
  };
}

/** 테스트용 PlayerInput. 기본값은 가만히 서 있기. */
export function makeInput(partial: Partial<PlayerInput> = {}): PlayerInput {
  return {
    seq: 1,
    move: { x: 0, y: 0 },
    run: false,
    aim: 0,
    toggleFlashlight: false,
    interact: false,
    drop: false,
    selectSlot: null,
    ping: null,
    chat: null,
    flicker: false,
    ...partial,
  };
}

/** 테스트용 ItemState. */
export function makeItem(id: string, weight: number, partial: Partial<ItemState> = {}): ItemState {
  return { id, kind: 'scrap', value: 10, weight, pos: { x: 0, y: 0 }, floor: 0, carriedBy: null, loaded: false, ...partial };
}

/** 테스트용 World. 플레이어 수는 players 개수로 정한다. createWorld가 생기기 전까지 쓰는 손수 만든 월드. */
export function makeWorld(partial: Partial<World> = {}): World {
  const players = partial.players ?? {};
  return {
    tick: 0,
    time: 0,
    seed: 1,
    rngState: 1,
    mapId: 'parking-lot',
    playerCount: Object.keys(players).length,
    players,
    items: {},
    stalkers: [],
    watcher: { id: 'watcher', floor: 0, pos: { x: 0, y: 0 }, active: false, frozen: false, moving: false, path: [], waitTimer: 0 },
    lights: [],
    round: { clock: 0, target: 250, truckTotal: 0, phase: 'playing', watcherSpawned: false, lightsHalved: false, horned: false },
    events: [],
    ...partial,
  };
}
