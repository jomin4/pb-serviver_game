import { CONFIG } from '@bh/shared';
import type { FloorId, ItemState, LightState } from '@bh/shared';
import type { MonsterView, RenderPlayer } from '../render/visibility.ts';

/**
 * 서버 스키마(packages/server/src/schema.ts)로 디코딩된 상태를 렌더·예측용 평범한 객체로 바꾼다.
 * 스키마 객체를 그대로 들고 다니지 않는다(다음 패치가 제자리에서 바꾸므로). 서버 내부 필드
 * (interactHeld, prevInteract, cooldowns)는 동기화되지 않으므로 기본값을 채운다.
 */
export type PlayerSchemaView = {
  id: string; name: string; x: number; y: number; floor: number; aim: number;
  flashlightOn: boolean; battery: number; hp: number; stamina: number; alive: boolean;
  inventory: Iterable<string>; selectedSlot: number; lastSeq: number;
  onStairs: boolean; exhausted: boolean; connected: boolean; carriedTotal: number;
  colorIndex: number; isHost: boolean; joinOrder: number;
};
export type ItemSchemaView = {
  id: string; kind: string; value: number; weight: number; x: number; y: number; floor: number;
  carriedBy: string; loaded: boolean;
};
export type MonsterSchemaView = {
  id: string; kind: string; mode: string; active: boolean; moving: boolean; frozen: boolean;
  floor: number; x: number; y: number;
};
export type LightSchemaView = {
  id: string; floor: number; x: number; y: number; radius: number; on: boolean; flickering: boolean; flickerUntil: number;
};

const floorOf = (n: number): FloorId => (n === 1 ? 1 : 0);
const slotOf = (n: number): 0 | 1 | 2 => (n === 1 || n === 2 ? n : 0);

export function toPlayer(p: PlayerSchemaView): RenderPlayer {
  return {
    id: p.id, name: p.name, pos: { x: p.x, y: p.y }, floor: floorOf(p.floor), aim: p.aim,
    flashlightOn: p.flashlightOn, battery: p.battery, hp: p.hp, stamina: p.stamina, alive: p.alive,
    inventory: [...p.inventory], selectedSlot: slotOf(p.selectedSlot), lastSeq: p.lastSeq,
    interactHeld: 0, prevInteract: false, onStairs: p.onStairs, exhausted: p.exhausted, connected: p.connected,
    cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: p.carriedTotal, colorIndex: p.colorIndex,
  };
}

export function toItem(i: ItemSchemaView): ItemState {
  return {
    id: i.id, kind: i.kind, value: i.value, weight: i.weight, pos: { x: i.x, y: i.y }, floor: floorOf(i.floor),
    carriedBy: i.carriedBy === '' ? null : i.carriedBy, loaded: i.loaded,
  };
}

export function toMonster(m: MonsterSchemaView): MonsterView {
  return { id: m.id, kind: m.kind === 'watcher' ? 'watcher' : 'stalker', pos: { x: m.x, y: m.y }, floor: floorOf(m.floor), active: m.active };
}

export function toLight(l: LightSchemaView): LightState {
  return {
    id: l.id, floor: floorOf(l.floor), pos: { x: l.x, y: l.y }, radius: l.radius, on: l.on,
    flickering: l.flickering, flickerUntil: l.flickerUntil,
  };
}

/** 서버 시각(초). world.time은 동기화되지 않으므로 게임 시계(분)에서 되돌린다(R13). */
export const serverTime = (clock: number): number => clock * CONFIG.realSecondsPerGameMinute;
