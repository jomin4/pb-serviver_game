import type { Vec } from './types.ts';

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });
export const len = (v: Vec): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 길이 1로 맞춘다. 영벡터는 영벡터 그대로 돌려준다. */
export function normalize(v: Vec): Vec {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/** from에서 to를 바라보는 각도(라디안, 0 = +x, 캔버스 좌표계에서 시계 방향이 +). */
export const angleTo = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x);

/** a − b를 −π..π로 감싼 값. */
export function angleDiff(a: number, b: number): number {
  const d = (((a - b + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return d - Math.PI;
}

const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function onSegment(a: Vec, b: Vec, p: Vec): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

/** 두 선분(끝점 접촉·공선 겹침 포함)이 만나는지. */
export function segmentsIntersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(q1, q2, p1)) return true;
  if (d2 === 0 && onSegment(q1, q2, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, q1)) return true;
  if (d4 === 0 && onSegment(p1, p2, q2)) return true;
  return false;
}

/** 타일 좌표(정수)의 중앙 좌표. */
export const tileCenter = (t: Vec): Vec => ({ x: Math.floor(t.x) + HALF, y: Math.floor(t.y) + HALF });
