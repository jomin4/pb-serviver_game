import { CONFIG, dist, visibilityPolygon } from '@bh/shared';
import type { FloorId, ItemState, LightState, MapData, PlayerState, Vec } from '@bh/shared';
import type { WorldRect } from './camera.ts';

/** 렌더용 플레이어. 서버 상태 모양(`PlayerState`)에 색 번호를 더했다. */
export type RenderPlayer = PlayerState & { colorIndex: number };
/** `moving`·`frozen`은 서버가 알려주는 값(소리가 읽는다). 없으면 모른다. */
export type MonsterView = { id: string; kind: 'stalker' | 'watcher'; pos: Vec; floor: FloorId; active: boolean; moving?: boolean; frozen?: boolean };
export type PingView = { pos: Vec; floor: FloorId; until: number };

/**
 * 한 프레임을 그리는 데 필요한 전부. `self`는 예측한 내 상태(조준은 로컬 값), `players`는 나를 포함한
 * 모든 플레이어(내 항목은 `self`로 본다), `items`는 들고 있거나 실린 것까지 모두(HUD가 소지품을 찾는다).
 * `time`과 `pings[].until`은 서버 시각(초)이다.
 */
export type RenderSnapshot = {
  selfId: string;
  self: RenderPlayer;
  players: RenderPlayer[];
  items: ItemState[];
  monsters: MonsterView[];
  lights: LightState[];
  time: number;
  pings: PingView[];
};

export type LightSource = {
  pos: Vec;
  radius: number;
  arc?: { aim: number; angle: number };
  /** 움직이지 않는 광원(고정 조명, 트럭)의 식별자. 있으면 다각형을 캐시한다. */
  key?: string;
};
export type LitArea = { source: LightSource; poly: Vec[] };

export type VisibleEntities = { items: ItemState[]; monsters: MonsterView[]; players: RenderPlayer[] };

/** 나를 `self`로 바꿔 넣은 플레이어 목록(목록에 내가 없으면 더한다). */
function everyone(snap: RenderSnapshot): RenderPlayer[] {
  let found = false;
  const list = snap.players.map((p) => {
    if (p.id !== snap.selfId) return p;
    found = true;
    return snap.self;
  });
  if (!found) list.push(snap.self);
  return list;
}

/**
 * 켜진 고정 조명이 지금 빛나는가. 원래 깜빡이는 조명(`flickering`)과 유령이 깜빡이게 한 조명
 * (`time < flickerUntil`)은 `Math.floor(time × flickerBlinkHz) % 2`가 1일 때만 빛난다.
 */
export function isLightLit(l: LightState, time: number): boolean {
  if (!l.on) return false;
  const blinking = l.flickering || time < l.flickerUntil;
  return !blinking || Math.floor(time * CONFIG.fx.flickerBlinkHz) % 2 === 1;
}

/** 같은 층의 활성 몬스터 중 가장 가까운 거리. `CONFIG.fx.dangerDistance` 이하일 때만, 아니면 null (긴장 효과·심장 소리). */
export function dangerDistance(snap: RenderSnapshot): number | null {
  const self = snap.self;
  let best: number | null = null;
  for (const m of snap.monsters) {
    if (!m.active || m.floor !== self.floor) continue;
    const d = dist(m.pos, self.pos);
    if (d <= CONFIG.fx.dangerDistance && (best === null || d < best)) best = d;
  }
  return best;
}

/** 트럭 구역(B1) 가운데. */
export function truckCenter(map: MapData): Vec {
  const z = map.truckZone;
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

/**
 * 내 층의 광원(스펙 4.3): 살아 있는 플레이어의 주변 빛과 켜진 손전등, 지금 빛나는 고정 조명,
 * B1이면 트럭 구역 빛. 유령은 빛을 내지 않는다. 시점이 유령이어도 같은 층 생존자의 빛은 그대로 보인다.
 */
export function lightSources(snap: RenderSnapshot, map: MapData): LightSource[] {
  const floor = snap.self.floor;
  const out: LightSource[] = [];
  for (const p of everyone(snap)) {
    if (!p.alive || p.floor !== floor) continue;
    out.push({ pos: p.pos, radius: CONFIG.player.ambientRadius });
    if (p.flashlightOn) out.push({ pos: p.pos, radius: CONFIG.flashlight.range, arc: { aim: p.aim, angle: CONFIG.flashlight.angle } });
  }
  for (const l of snap.lights) {
    if (l.floor === floor && isLightLit(l, snap.time)) out.push({ pos: l.pos, radius: l.radius, key: `light:${l.id}` });
  }
  if (floor === 0) out.push({ pos: truckCenter(map), radius: CONFIG.fx.truckLightRadius, key: 'truck' });
  return out;
}

/** 움직이지 않는 광원의 다각형 캐시. 맵마다 따로 둔다. */
const staticPolys = new WeakMap<MapData, Map<string, Vec[]>>();

function polygonFor(map: MapData, floor: FloorId, s: LightSource): Vec[] {
  if (!s.key) return visibilityPolygon(map, floor, s.pos, s.radius, s.arc);
  let cache = staticPolys.get(map);
  if (!cache) { cache = new Map(); staticPolys.set(map, cache); }
  const id = `${floor}|${s.key}|${s.pos.x}|${s.pos.y}|${s.radius}`;
  let poly = cache.get(id);
  if (!poly) { poly = visibilityPolygon(map, floor, s.pos, s.radius, s.arc); cache.set(id, poly); }
  return poly;
}

function touches(s: LightSource, view: WorldRect): boolean {
  const m = CONFIG.fx.lightCullMargin + s.radius;
  return s.pos.x + m >= view.x && s.pos.x - m <= view.x + view.w && s.pos.y + m >= view.y && s.pos.y - m <= view.y + view.h;
}

/**
 * 광원별로 벽에 막힌 빛 영역(`visibilityPolygon`). `view`를 주면 반경 + 여유가 그 영역에 닿는 광원만 계산한다.
 * 고정 광원의 다각형은 한 번만 계산해 재사용한다.
 */
export function litAreas(snap: RenderSnapshot, map: MapData, view?: WorldRect): LitArea[] {
  const floor = snap.self.floor;
  const out: LitArea[] = [];
  for (const s of lightSources(snap, map)) {
    if (view && !touches(s, view)) continue;
    out.push({ source: s, poly: polygonFor(map, floor, s) });
  }
  return out;
}

/** 짝수-홀수 규칙의 점-다각형 포함 판정. */
export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 어떤 빛 영역 안이면 true. 반경으로 먼저 거른다. */
export function isLit(p: Vec, areas: LitArea[]): boolean {
  return areas.some((a) => dist(a.source.pos, p) <= a.source.radius && pointInPolygon(p, a.poly));
}

/**
 * 그릴 엔티티(스펙 3.2 정보 가리기, 4.3 가시 조건). 들고 있거나 실린 폐품과 비활성 몬스터는 항상 뺀다.
 * - 생존자 시점: 같은 층에서 빛 영역 안의 몬스터·폐품, 같은 층의 살아 있는 플레이어(유령은 숨김).
 * - 유령 시점: 같은 층의 모든 몬스터·폐품·플레이어(유령 포함).
 * `areas`를 넘기면 그 빛 영역으로 판정한다(렌더러가 계산한 것을 재사용).
 */
export function visibleEntities(snap: RenderSnapshot, map: MapData, areas: LitArea[] = litAreas(snap, map)): VisibleEntities {
  const floor = snap.self.floor;
  const ghostView = !snap.self.alive;
  const seen = (pos: Vec): boolean => ghostView || isLit(pos, areas);
  return {
    items: snap.items.filter((i) => i.carriedBy === null && !i.loaded && i.floor === floor && seen(i.pos)),
    monsters: snap.monsters.filter((m) => m.active && m.floor === floor && seen(m.pos)),
    players: everyone(snap).filter((p) => p.floor === floor && (p.alive || ghostView)),
  };
}
