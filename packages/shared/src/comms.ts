import { CONFIG } from './config.ts';
import type { PlayerState, Vec, World } from './types.ts';

/**
 * 퀵챗. 플레이어(생존자·유령)가 존재하고 쿨타임이 0이며 `index`가 `quickChats`의 정수 인덱스일 때
 * `chat` 이벤트를 추가하고 쿨타임을 시작한다. 월드와 플레이어를 직접 변경한다.
 */
export function tryChat(world: World, playerId: string, index: number): boolean {
  const p = world.players[playerId];
  if (!p || p.cooldowns.chat > 0) return false;
  if (!Number.isInteger(index) || index < 0 || index >= CONFIG.comms.quickChats.length) return false;
  world.events.push({ type: 'chat', playerId, index });
  p.cooldowns.chat = CONFIG.comms.chatCooldown;
  return true;
}

/**
 * 핑. 플레이어(생존자·유령)가 존재하고 쿨타임이 0이면 플레이어의 현재 층에 `ping` 이벤트를 추가하고
 * 쿨타임을 시작한다. 위치는 복사해 담으며 맵 경계 제한은 하지 않는다(`step`의 몫).
 * 월드와 플레이어를 직접 변경한다.
 */
export function tryPing(world: World, playerId: string, pos: Vec): boolean {
  const p = world.players[playerId];
  if (!p || p.cooldowns.ping > 0) return false;
  world.events.push({ type: 'ping', playerId, floor: p.floor, pos: { x: pos.x, y: pos.y } });
  p.cooldowns.ping = CONFIG.comms.pingCooldown;
  return true;
}

/** 부동소수 누적 오차(예: 3 − 2.9 − 0.1 = 9e-17)로 쿨타임이 "거의 0"에 남는 것을 막는 문턱. */
const COOLDOWN_EPS = 1e-9;

const tick = (x: number, dt: number): number => {
  const v = x - dt;
  return v <= COOLDOWN_EPS ? 0 : v;
};

/** 쿨타임을 dt만큼 줄인다(0 미만으로는 내려가지 않고, 오차 수준의 잔량은 0으로 만든다). `p.cooldowns`를 직접 변경한다. */
export function tickCooldowns(p: PlayerState, dt: number): void {
  const c = p.cooldowns;
  c.flicker = tick(c.flicker, dt);
  c.ping = tick(c.ping, dt);
  c.chat = tick(c.chat, dt);
}
