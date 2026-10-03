import { CONFIG } from './config.ts';
import { dist } from './geometry.ts';
import type { MapData } from './map/index.ts';
import type { Rng } from './rng.ts';
import type { ItemState, PlayerState, World } from './types.ts';

export const ITEM_KINDS = ['고철', '구리 전선', '낡은 자전거', '폐가전', '녹슨 공구함'] as const;

/** 인원별 폐품 개수. 4인 기준 countAt4개를 목표액 비례로 줄이되 minCount 아래로 내려가지 않는다. */
export function itemCountFor(playerCount: 1 | 2 | 3 | 4): number {
  const { countAt4, minCount } = CONFIG.items;
  return Math.max(minCount, Math.round((countAt4 * CONFIG.difficulty[playerCount].target) / CONFIG.difficulty[4].target));
}

/**
 * 서로 다른 itemSlot에 폐품을 배치한다. 총액은 round(totalFactor × target)에 정확히 맞춘다(±5% 안).
 * 값·무게는 정수이며 범위 안. 맞출 수 없으면 Error. rng 외의 난수는 쓰지 않는다.
 */
export function spawnItems(map: MapData, rng: Rng, playerCount: 1 | 2 | 3 | 4): Record<string, ItemState> {
  const { valueMin, valueMax, weightMin, weightMax, totalFactor } = CONFIG.items;
  const count = itemCountFor(playerCount);
  if (map.itemSlots.length < count) throw new Error(`not enough item slots: ${map.itemSlots.length} < ${count}`);

  // 슬롯 비복원 추출(부분 Fisher-Yates)
  const pool = map.itemSlots.slice();
  const slots = [];
  for (let i = 0; i < count; i++) {
    const j = rng.int(i, pool.length - 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    slots.push(pool[i]);
  }

  // 값: 무작위로 뽑고 비율 조정 → 반올림·범위 자르기 → 남은 차이를 1씩 조정
  const goal = totalFactor * CONFIG.difficulty[playerCount].target;
  const goalInt = Math.round(goal);
  const raw = Array.from({ length: count }, () => rng.int(valueMin, valueMax));
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const values = raw.map(v => Math.min(valueMax, Math.max(valueMin, Math.round((v * goal) / rawSum))));
  let diff = goalInt - values.reduce((s, v) => s + v, 0);
  const start = rng.int(0, count - 1);
  while (diff !== 0) {
    const step = Math.sign(diff);
    let moved = false;
    for (let k = 0; k < count && diff !== 0; k++) {
      const i = (start + k) % count;
      const next = values[i] + step;
      if (next < valueMin || next > valueMax) continue;
      values[i] = next;
      diff -= step;
      moved = true;
    }
    if (!moved) throw new Error('cannot fit item values to the target total');
  }
  const total = values.reduce((s, v) => s + v, 0);
  if (Math.abs(total - goal) > goal * 0.05) throw new Error(`item total ${total} out of range for goal ${goal}`);

  const items: Record<string, ItemState> = {};
  for (let i = 0; i < count; i++) {
    const id = `item-${i}`;
    items[id] = {
      id,
      kind: ITEM_KINDS[rng.int(0, ITEM_KINDS.length - 1)],
      value: values[i],
      weight: rng.int(weightMin, weightMax),
      pos: { x: slots[i].pos.x, y: slots[i].pos.y },
      floor: slots[i].floor,
      carriedBy: null,
      loaded: false,
    };
  }
  return items;
}

function canReach(player: PlayerState, item: ItemState): boolean {
  return player.alive && item.carriedBy === null && !item.loaded && item.floor === player.floor
    && dist(player.pos, item.pos) <= CONFIG.player.interactRange;
}

/** 같은 층 바닥에 있고 interactRange 안인 가장 가까운 폐품 id. 없으면 null. */
export function nearestPickable(world: World, playerId: string): string | null {
  const player = world.players[playerId];
  if (!player || !player.alive) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const item of Object.values(world.items)) {
    if (!canReach(player, item)) continue;
    const d = dist(player.pos, item.pos);
    if (d < bestDist) { best = item.id; bestDist = d; }
  }
  return best;
}

/** (world를 직접 변경) 조건이 맞을 때만 줍는다. 칸이 꽉 찼거나 이미 누가 들었으면 아무것도 하지 않는다. */
export function pickUp(world: World, playerId: string, itemId: string): void {
  const player = world.players[playerId];
  const item = world.items[itemId];
  if (!player || !item || !canReach(player, item)) return;
  if (player.inventory.length >= CONFIG.player.slots) return;
  item.carriedBy = playerId;
  player.inventory.push(itemId);
}

function release(world: World, player: PlayerState, itemId: string): void {
  const item = world.items[itemId];
  if (!item) return;
  item.carriedBy = null;
  item.pos = { x: player.pos.x, y: player.pos.y };
  item.floor = player.floor;
}

function clampSlot(player: PlayerState): void {
  const max = Math.max(0, Math.min(CONFIG.player.slots - 1, player.inventory.length - 1));
  if (player.selectedSlot > max) player.selectedSlot = max as PlayerState['selectedSlot'];
}

/** (world를 직접 변경) 선택한 칸의 폐품을 발치에 떨어뜨린다. 떨어뜨린 id, 비어 있으면 null. */
export function dropSelected(world: World, playerId: string): string | null {
  const player = world.players[playerId];
  if (!player) return null;
  const itemId = player.inventory[player.selectedSlot];
  if (itemId === undefined) return null;
  release(world, player, itemId);
  player.inventory.splice(player.selectedSlot, 1);
  clampSlot(player);
  return itemId;
}

/** (world를 직접 변경) 소지품을 모두 발치에 떨어뜨린다. */
export function dropAll(world: World, playerId: string): void {
  const player = world.players[playerId];
  if (!player) return;
  for (const itemId of player.inventory) release(world, player, itemId);
  player.inventory = [];
  player.selectedSlot = 0;
}

/** (world를 직접 변경) 소지품을 트럭에 싣는다. 트럭 구역 검사는 호출자 몫. 실은 총액을 돌려준다. */
export function loadIntoTruck(world: World, playerId: string): number {
  const player = world.players[playerId];
  if (!player) return 0;
  let sum = 0;
  for (const itemId of player.inventory) {
    const item = world.items[itemId];
    if (!item) continue;
    item.loaded = true;
    item.carriedBy = null;
    sum += item.value;
  }
  player.inventory = [];
  player.selectedSlot = 0;
  player.carriedTotal += sum;
  world.round.truckTotal += sum;
  return sum;
}
