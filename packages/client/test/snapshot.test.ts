import { describe, expect, it } from 'vitest';
import { CONFIG } from '@bh/shared';
import { serverTime, toItem, toLight, toMonster, toPlayer } from '../src/sim/snapshot.ts';

/** 스키마 디코딩 결과처럼 생긴 평범한 객체(ArraySchema는 반복 가능 객체로 흉내 낸다). */
const schemaPlayer = {
  id: 'p1', name: '가', x: 3.5, y: 4.25, floor: 1, aim: 0.5, flashlightOn: true, battery: 100, hp: 1, stamina: 2.5,
  alive: true, inventory: new Set(['i1', 'i2']), selectedSlot: 2, lastSeq: 41, onStairs: false, exhausted: true,
  connected: false, carriedTotal: 30, colorIndex: 3, isHost: true, joinOrder: 0,
};

describe('schema → 렌더 상태 변환', () => {
  it('플레이어: 동기화 필드를 옮기고 서버 내부 필드는 기본값', () => {
    const p = toPlayer(schemaPlayer);
    expect(p).toEqual({
      id: 'p1', name: '가', pos: { x: 3.5, y: 4.25 }, floor: 1, aim: 0.5, flashlightOn: true, battery: 100, hp: 1,
      stamina: 2.5, alive: true, inventory: ['i1', 'i2'], selectedSlot: 2, lastSeq: 41, interactHeld: 0,
      prevInteract: false, onStairs: false, exhausted: true, connected: false,
      cooldowns: { flicker: 0, ping: 0, chat: 0 }, carriedTotal: 30, colorIndex: 3,
    });
  });

  it('범위 밖 층·칸 값은 안전한 값으로', () => {
    const p = toPlayer({ ...schemaPlayer, floor: 7, selectedSlot: 9 });
    expect(p.floor).toBe(0);
    expect(p.selectedSlot).toBe(0);
  });

  it('폐품: carriedBy 빈 문자열은 null', () => {
    const base = { id: 'i1', kind: '고철', value: 20, weight: 5, x: 1, y: 2, floor: 0, carriedBy: '', loaded: false };
    expect(toItem(base)).toEqual({ id: 'i1', kind: '고철', value: 20, weight: 5, pos: { x: 1, y: 2 }, floor: 0, carriedBy: null, loaded: false });
    expect(toItem({ ...base, carriedBy: 'p1' }).carriedBy).toBe('p1');
  });

  it('몬스터와 조명', () => {
    expect(toMonster({ id: 'w', kind: 'watcher', mode: '', active: false, moving: false, frozen: true, floor: 1, x: 5, y: 6 }))
      .toEqual({ id: 'w', kind: 'watcher', pos: { x: 5, y: 6 }, floor: 1, active: false, moving: false, frozen: true });
    expect(toMonster({ id: 's', kind: 'stalker', mode: 'chase', active: true, moving: true, frozen: false, floor: 0, x: 1, y: 1 }).kind).toBe('stalker');
    expect(toLight({ id: 'l', floor: 0, x: 7.5, y: 5.5, radius: 5, on: true, flickering: true, flickerUntil: 12 }))
      .toEqual({ id: 'l', floor: 0, pos: { x: 7.5, y: 5.5 }, radius: 5, on: true, flickering: true, flickerUntil: 12 });
  });

  it('서버 시각(초) = 게임 시계(분) × 실제 초/게임 분', () => {
    expect(serverTime(0)).toBe(0);
    expect(serverTime(10)).toBe(10 * CONFIG.realSecondsPerGameMinute);
  });
});
