import { CONFIG } from './config.ts';
import { angleDiff, angleTo, dist, segmentsIntersect } from './geometry.ts';
import { isSolid, tileAt } from './map/grid.ts';
import type { MapData } from './map/types.ts';
import type { FloorId, Vec } from './types.ts';

export type Segment = { a: Vec; b: Vec };

const TWO_PI = Math.PI * 2;
/** 선분 끝점 방향 광선을 양옆으로 비껴 쏘는 각도(라디안). 끝점 너머와 앞을 각각 잡는다. */
const CORNER_EPSILON = 0.0001;
/** 광선이 아무것도 못 맞출 때 반경 원/부채꼴 경계를 근사하는 추가 광선 간격(10°). */
const BOUNDARY_STEP = Math.PI / 18;
const EPS = 1e-9;

// ---------------------------------------------------------------- wallSegments

const segmentCache = new WeakMap<MapData, [Segment[] | undefined, Segment[] | undefined]>();

/** 한 직선(`line`) 위에서 `from` 칸부터 이어진 변들을 하나로 합쳐 `out`에 넣는다. */
function mergeRuns(flags: boolean[], line: number, horizontal: boolean, out: Segment[]): void {
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push(
        horizontal
          ? { a: { x: start, y: line }, b: { x: i, y: line } }
          : { a: { x: line, y: start }, b: { x: line, y: i } },
      );
      start = -1;
    }
  }
}

function buildWallSegments(map: MapData, floor: FloorId): Segment[] {
  const { width, height } = map.floors[floor];
  // 범위 밖은 tileAt 규칙대로 벽이지만, 변은 "범위 안의 단단한 칸 ↔ 범위 안의 비단단 칸" 사이에서만 만든다.
  // 그래서 맵 가장자리(범위 밖과의 경계)는 선분을 만들지 않는다.
  const solid = (tx: number, ty: number): boolean => isSolid(tileAt(map, floor, tx, ty));
  const inRange = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height;
  const edge = (tx: number, ty: number, nx: number, ny: number): boolean =>
    inRange(nx, ny) && solid(tx, ty) !== solid(nx, ny);

  const out: Segment[] = [];
  // 가로선 y = 0..height: 위 칸(y-1)과 아래 칸(y) 사이. 둘 중 하나만 단단할 때 변이 있다.
  for (let y = 1; y < height; y++) {
    const flags: boolean[] = [];
    for (let x = 0; x < width; x++) flags.push(edge(x, y - 1, x, y));
    mergeRuns(flags, y, true, out);
  }
  // 세로선 x = 1..width-1: 왼 칸(x-1)과 오른 칸(x) 사이.
  for (let x = 1; x < width; x++) {
    const flags: boolean[] = [];
    for (let y = 0; y < height; y++) flags.push(edge(x - 1, y, x, y));
    mergeRuns(flags, x, false, out);
  }
  return out;
}

/**
 * 층의 벽 선분. 단단한 칸(벽·기둥·차)과 비단단 칸 사이 외곽선만 만들고(인접한 단단한 칸 사이 변은 제외),
 * 같은 직선 위에서 이어지는 변은 하나로 합친다. 맵 가장자리는 선분을 만들지 않는다.
 * (맵, 층)별로 메모이즈되므로 돌려받은 배열을 수정하면 안 된다.
 */
export function wallSegments(map: MapData, floor: FloorId): Segment[] {
  let entry = segmentCache.get(map);
  if (!entry) {
    entry = [undefined, undefined];
    segmentCache.set(map, entry);
  }
  let segs = entry[floor];
  if (!segs) {
    segs = buildWallSegments(map, floor);
    entry[floor] = segs;
  }
  return segs;
}

// ---------------------------------------------------------------- 시선·손전등

/**
 * `from`에서 `to`로 그은 선분이 벽 선분과 하나도 만나지 않으면 true.
 * 끝점·모서리에 정확히 닿거나 벽면을 따라 겹치는 경우는 만난 것(막힘)으로 본다.
 */
export function hasLineOfSight(map: MapData, floor: FloorId, from: Vec, to: Vec): boolean {
  for (const s of wallSegments(map, floor)) {
    if (segmentsIntersect(from, to, s.a, s.b)) return false;
  }
  return true;
}

/** 손전등 부채꼴(`CONFIG.flashlight`의 각도·사거리) 안이면서 벽에 가려지지 않으면 true. */
export function inFlashlight(map: MapData, floor: FloorId, origin: Vec, aim: number, target: Vec): boolean {
  const d = dist(origin, target);
  if (d > CONFIG.flashlight.range) return false;
  if (d > EPS && Math.abs(angleDiff(angleTo(origin, target), aim)) > CONFIG.flashlight.angle / 2) return false;
  return hasLineOfSight(map, floor, origin, target);
}

// ---------------------------------------------------------------- 가시 다각형

/** 광선(origin, 단위방향 dir)과 선분의 교차 거리. 안 만나면 Infinity. */
function rayHit(origin: Vec, dx: number, dy: number, s: Segment): number {
  const sx = s.b.x - s.a.x;
  const sy = s.b.y - s.a.y;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < EPS) return Infinity; // 평행
  const ax = s.a.x - origin.x;
  const ay = s.a.y - origin.y;
  const t = (ax * sy - ay * sx) / denom; // 광선 위 거리
  const u = (ax * dy - ay * dx) / denom; // 선분 위 비율
  return t >= 0 && u >= -EPS && u <= 1 + EPS ? t : Infinity;
}

/**
 * `origin`에서 보이는 영역의 다각형(꼭짓점은 각도순). 광선 길이는 `radius`로 자르며,
 * 아무것도 못 맞춘 광선은 반경 원 위에서 끝난다.
 * `arc`가 있으면 `aim` ± `angle`/2 부채꼴로 자르고, 꼭짓점 목록이 원점에서 시작해 원점으로 끝난다.
 */
export function visibilityPolygon(
  map: MapData,
  floor: FloorId,
  origin: Vec,
  radius: number,
  arc?: { aim: number; angle: number },
): Vec[] {
  const full = !arc || arc.angle >= TWO_PI;
  const half = arc ? arc.angle / 2 : Math.PI;
  const aim = arc ? arc.aim : 0;
  // 후보 각도는 조준 방향 기준 상대 각도(−half..half)로 다룬다. 전체 원이면 −π..π.
  const inRange = (rel: number): boolean => full || Math.abs(rel) <= half;
  const rels: number[] = [];
  const push = (rel: number): void => {
    if (inRange(rel)) rels.push(rel);
  };

  // 반경 안에 들어오는 선분만 고려한다.
  const segs = wallSegments(map, floor).filter(
    (s) =>
      Math.max(s.a.x, s.b.x) >= origin.x - radius && Math.min(s.a.x, s.b.x) <= origin.x + radius &&
      Math.max(s.a.y, s.b.y) >= origin.y - radius && Math.min(s.a.y, s.b.y) <= origin.y + radius,
  );

  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      if (dist(origin, p) > radius) continue;
      const rel = angleDiff(angleTo(origin, p), aim);
      push(rel - CORNER_EPSILON);
      push(rel + CORNER_EPSILON);
    }
  }
  // 반경 원(또는 부채꼴 호)을 근사하는 광선.
  if (full) {
    for (let a = -Math.PI; a < Math.PI - EPS; a += BOUNDARY_STEP) rels.push(a);
  } else {
    rels.push(-half, half);
    for (let a = -half + BOUNDARY_STEP; a < half - EPS; a += BOUNDARY_STEP) rels.push(a);
  }
  rels.sort((p, q) => p - q);

  const points: Vec[] = [];
  for (const rel of rels) {
    const ang = aim + rel;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let t = radius;
    for (const s of segs) {
      const h = rayHit(origin, dx, dy, s);
      if (h < t) t = h;
    }
    points.push({ x: origin.x + dx * t, y: origin.y + dy * t });
  }
  return full ? points : [origin, ...points, origin];
}
