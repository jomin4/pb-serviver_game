import { schema, t } from '@colyseus/schema';
import type { SchemaType } from '@colyseus/schema';
import type { World } from '@bh/shared';

/** 동기화되는 플레이어. cooldowns, prevInteract, interactHeld는 서버 내부 값이라 뺀다. */
export const PlayerS = schema({
  id: t.string().default(''),
  name: t.string().default(''),
  x: t.number().default(0),
  y: t.number().default(0),
  floor: t.number().default(0),
  aim: t.number().default(0),
  flashlightOn: t.boolean().default(false),
  battery: t.number().default(0),
  hp: t.number().default(0),
  stamina: t.number().default(0),
  alive: t.boolean().default(false),
  inventory: t.array("string"),
  selectedSlot: t.number().default(0),
  lastSeq: t.number().default(0),
  onStairs: t.boolean().default(false),
  exhausted: t.boolean().default(false),
  connected: t.boolean().default(false),
  carriedTotal: t.number().default(0),
  colorIndex: t.number().default(0),
  isHost: t.boolean().default(false),
  joinOrder: t.number().default(0),
}, 'PlayerS');
export type PlayerS = SchemaType<typeof PlayerS>;

export const ItemS = schema({
  id: t.string().default(''),
  kind: t.string().default(''),
  value: t.number().default(0),
  weight: t.number().default(0),
  x: t.number().default(0),
  y: t.number().default(0),
  floor: t.number().default(0),
  carriedBy: t.string().default(''),
  loaded: t.boolean().default(false),
}, 'ItemS');
export type ItemS = SchemaType<typeof ItemS>;

/** 추적자와 감시자 공용. kind는 'stalker' | 'watcher'. */
export const MonsterS = schema({
  id: t.string().default(''),
  kind: t.string().default(''),
  mode: t.string().default(''),
  active: t.boolean().default(false),
  moving: t.boolean().default(false),
  frozen: t.boolean().default(false),
  floor: t.number().default(0),
  x: t.number().default(0),
  y: t.number().default(0),
}, 'MonsterS');
export type MonsterS = SchemaType<typeof MonsterS>;

export const LightS = schema({
  id: t.string().default(''),
  floor: t.number().default(0),
  x: t.number().default(0),
  y: t.number().default(0),
  radius: t.number().default(0),
  on: t.boolean().default(false),
  flickering: t.boolean().default(false),
  flickerUntil: t.number().default(0),
}, 'LightS');
export type LightS = SchemaType<typeof LightS>;

export type RoomPhase = 'lobby' | 'playing' | 'result';
export type RoundResult = '' | 'success' | 'fail';

export const RoomState = schema({
  phase: t.string().default(''),
  hostId: t.string().default(''),
  mapId: t.string().default(''),
  seed: t.number().default(0),
  clock: t.number().default(0),
  target: t.number().default(0),
  truckTotal: t.number().default(0),
  result: t.string().default(''),
  players: t.map(PlayerS),
  items: t.map(ItemS),
  monsters: t.map(MonsterS),
  lights: t.map(LightS),
}, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;

type Keyed<T> = { forEach(cb: (value: T, key: string) => void): void; delete(key: string): boolean | void };

function pruneMissing<T>(map: Keyed<T>, keep: Set<string>): void {
  const stale: string[] = [];
  map.forEach((_v, key) => { if (!keep.has(key)) stale.push(key); });
  for (const key of stale) map.delete(key);
}

/**
 * world 값을 스키마로 복사하고 world에 없는 키는 지운다. 이미 있는 플레이어 항목은
 * 새로 만들지 않고 제자리에서 갱신한다(대기실에서 정한 joinOrder, colorIndex, isHost 유지).
 * room phase와 hostId는 방이 관리하므로 건드리지 않는다.
 */
export function syncSchema(world: World, state: RoomState): void {
  state.mapId = world.mapId;
  state.seed = world.seed;
  state.clock = world.round.clock;
  state.target = world.round.target;
  state.truckTotal = world.round.truckTotal;
  state.result = world.round.phase === 'playing' ? '' : world.round.phase;

  const playerIds = new Set<string>();
  for (const p of Object.values(world.players)) {
    playerIds.add(p.id);
    let s = state.players.get(p.id);
    if (!s) { s = new PlayerS(); s.id = p.id; state.players.set(p.id, s); }
    s.name = p.name;
    s.x = p.pos.x; s.y = p.pos.y; s.floor = p.floor; s.aim = p.aim;
    s.flashlightOn = p.flashlightOn; s.battery = p.battery; s.hp = p.hp; s.stamina = p.stamina;
    s.alive = p.alive;
    syncStrings(s.inventory, p.inventory);
    s.selectedSlot = p.selectedSlot; s.lastSeq = p.lastSeq;
    s.onStairs = p.onStairs; s.exhausted = p.exhausted; s.connected = p.connected;
    s.carriedTotal = p.carriedTotal;
  }
  pruneMissing(state.players, playerIds);

  const itemIds = new Set<string>();
  for (const it of Object.values(world.items)) {
    itemIds.add(it.id);
    let s = state.items.get(it.id);
    if (!s) { s = new ItemS(); s.id = it.id; state.items.set(it.id, s); }
    s.kind = it.kind; s.value = it.value; s.weight = it.weight;
    s.x = it.pos.x; s.y = it.pos.y; s.floor = it.floor;
    s.carriedBy = it.carriedBy ?? ''; s.loaded = it.loaded;
  }
  pruneMissing(state.items, itemIds);

  const monsterIds = new Set<string>();
  const monster = (id: string): MonsterS => {
    monsterIds.add(id);
    let s = state.monsters.get(id);
    if (!s) { s = new MonsterS(); s.id = id; state.monsters.set(id, s); }
    return s;
  };
  for (const st of world.stalkers) {
    const s = monster(st.id);
    s.kind = 'stalker'; s.mode = st.mode; s.active = true; s.moving = true; s.frozen = false;
    s.floor = st.floor; s.x = st.pos.x; s.y = st.pos.y;
  }
  const w = world.watcher;
  const ws = monster(w.id);
  ws.kind = 'watcher'; ws.mode = ''; ws.active = w.active; ws.moving = w.moving; ws.frozen = w.frozen;
  ws.floor = w.floor; ws.x = w.pos.x; ws.y = w.pos.y;
  pruneMissing(state.monsters, monsterIds);

  const lightIds = new Set<string>();
  for (const l of world.lights) {
    lightIds.add(l.id);
    let s = state.lights.get(l.id);
    if (!s) { s = new LightS(); s.id = l.id; state.lights.set(l.id, s); }
    s.floor = l.floor; s.x = l.pos.x; s.y = l.pos.y; s.radius = l.radius;
    s.on = l.on; s.flickering = l.flickering; s.flickerUntil = l.flickerUntil;
  }
  pruneMissing(state.lights, lightIds);
}

function syncStrings(target: { length: number; push(...v: string[]): number; pop(): string | undefined; [i: number]: string | undefined }, source: string[]): void {
  while (target.length > source.length) target.pop();
  for (let i = 0; i < source.length; i++) {
    if (i < target.length) { if (target[i] !== source[i]) target[i] = source[i]; }
    else target.push(source[i]!);
  }
}
