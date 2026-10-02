import { CONFIG } from './config.ts';
import { dist } from './geometry.ts';
import { applyStairs } from './movement.ts';
import type { MapData } from './map/types.ts';
import type { PlayerInput, PlayerState, World } from './types.ts';

/** 경계 값 자체는 "맵 밖"으로 보지 않도록 안쪽으로 둔다. */
const BOUND_EPS = 1e-6;

/**
 * 유령(죽은 플레이어)의 한 틱 이동. 새 PlayerState를 돌려주며 입력은 변경하지 않는다.
 * 이동량 = `input.move` × `CONFIG.ghost.speed` × dt. 벽은 무시하고 현재 층의 맵 경계 [0, 너비] × [0, 높이]
 * 안으로만 제한한 뒤 `applyStairs`로 생존자와 같은 방식의 층 이동을 처리한다. 스태미나는 쓰지 않는다.
 */
export function applyGhostMovement(map: MapData, p: PlayerState, input: PlayerInput, dt: number): PlayerState {
  const { width, height } = map.floors[p.floor];
  const speed = CONFIG.ghost.speed;
  const clamp = (v: number, max: number): number => Math.min(max - BOUND_EPS, Math.max(BOUND_EPS, v));
  const pos = {
    x: clamp(p.pos.x + input.move.x * speed * dt, width),
    y: clamp(p.pos.y + input.move.y * speed * dt, height),
  };
  return applyStairs(map, { ...p, pos });
}

/**
 * 유령의 형광등 깜빡이기. 플레이어가 존재하는 유령이고 쿨타임이 0이며, 같은 층 반경
 * `flickerRadius` 안에 켜진(`on`) 조명이 하나 이상일 때만 성공한다. 그 조명들의 `flickerUntil`을
 * `world.time + flickerSeconds`로 설정하고 `flicker` 이벤트(id 정렬)를 추가하며 쿨타임을 시작한다.
 * 조명이 없으면 false를 돌려주고 쿨타임을 쓰지 않는다. 월드와 플레이어를 직접 변경한다.
 */
export function tryFlicker(world: World, playerId: string): boolean {
  const p = world.players[playerId];
  if (!p || p.alive || p.cooldowns.flicker > 0) return false;
  const hit = world.lights.filter((l) => l.on && l.floor === p.floor && dist(l.pos, p.pos) <= CONFIG.ghost.flickerRadius);
  if (hit.length === 0) return false;
  for (const l of hit) l.flickerUntil = world.time + CONFIG.ghost.flickerSeconds;
  world.events.push({ type: 'flicker', lightIds: hit.map((l) => l.id).sort() });
  p.cooldowns.flicker = CONFIG.ghost.flickerCooldown;
  return true;
}
