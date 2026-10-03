import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.ts';
import { angleDiff, angleTo, dist } from '../src/geometry.ts';
import { hasLineOfSight, inFlashlight, visibilityPolygon, wallSegments } from '../src/vision.ts';
import type { Vec } from '../src/types.ts';
import { cloneMap, open20, solid2x1, tinyMap as tiny } from './fixtures/maps.ts';

const polar = (origin: Vec, angle: number, r: number): Vec => ({
  x: origin.x + Math.cos(angle) * r,
  y: origin.y + Math.sin(angle) * r,
});

/** 신발끈 공식 넓이. */
function area(poly: Vec[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

describe('wallSegments', () => {
  it('인접 벽 사이 변을 만들지 않는다', () => {
    expect(wallSegments(solid2x1, 0)).toHaveLength(4);
  });
  it('2×1 블록의 외곽선은 병합된 긴 변 2개와 짧은 변 2개다', () => {
    const lens = wallSegments(solid2x1, 0).map((s) => Math.round(dist(s.a, s.b))).sort();
    expect(lens).toEqual([1, 1, 2, 2]);
  });
  it('단단한 칸이 없는 층은 선분이 없다', () => {
    expect(wallSegments(solid2x1, 1)).toHaveLength(0);
  });
  it('같은 (맵, 층)은 같은 배열을 돌려준다(메모이즈)', () => {
    expect(wallSegments(tiny, 0)).toBe(wallSegments(tiny, 0));
    expect(wallSegments(tiny, 0)).not.toBe(wallSegments(tiny, 1));
  });
  it('바깥 벽의 안쪽 면은 한 변으로 병합된다', () => {
    // open20 층 0: 바깥 벽 안쪽 면 4개만 있어야 한다(각 길이 18).
    const segs = wallSegments(open20, 0);
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => Math.abs(dist(s.a, s.b) - 18) < 1e-9)).toBe(true);
  });
});

describe('hasLineOfSight', () => {
  it('벽 뒤는 시선이 막힌다', () => {
    expect(hasLineOfSight(tiny, 0, { x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 })).toBe(false);
  });
  it('트인 곳은 보인다', () => {
    expect(hasLineOfSight(tiny, 0, { x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 })).toBe(true);
  });
  it('벽 위쪽 틈(y=1)을 지나는 시선은 통과한다', () => {
    expect(hasLineOfSight(tiny, 0, { x: 4.5, y: 1.5 }, { x: 8.5, y: 1.5 })).toBe(true);
  });
  it('모서리에 정확히 닿는 시선은 막힌 것으로 본다', () => {
    // (4.5,2.5) → (5.5,1.5)는 벽 끝 모서리 (5,2)를 정확히 지난다.
    expect(hasLineOfSight(tiny, 0, { x: 4.5, y: 2.5 }, { x: 5.5, y: 1.5 })).toBe(false);
  });
  it('층별로 따로 계산한다(B2에는 중간 벽이 없다)', () => {
    expect(hasLineOfSight(tiny, 1, { x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 })).toBe(true);
  });
  it('같은 지점이면 보인다', () => {
    expect(hasLineOfSight(tiny, 0, { x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 })).toBe(true);
  });
});

describe('inFlashlight', () => {
  const o = { x: 1.5, y: 1.5 };
  it('부채꼴 밖(31°)은 안 보인다', () => {
    expect(inFlashlight(tiny, 0, o, 0, polar(o, 0.54, 3))).toBe(false);
  });
  it('부채꼴 안(29°)은 보인다', () => {
    expect(inFlashlight(tiny, 0, o, 0, polar(o, 0.5, 3))).toBe(true);
  });
  it('반대쪽(−29°, −31°)도 대칭이다', () => {
    const c = { x: 5, y: 10 };
    expect(inFlashlight(open20, 0, c, 0, polar(c, -0.5, 3))).toBe(true);
    expect(inFlashlight(open20, 0, c, 0, polar(c, -0.54, 3))).toBe(false);
  });
  it('조준 방향이 ±π를 넘어가도 각도 비교가 맞다', () => {
    const c = { x: 10, y: 10 };
    expect(inFlashlight(open20, 0, c, Math.PI, polar(c, -Math.PI + 0.4, 3))).toBe(true);
    expect(inFlashlight(open20, 0, c, Math.PI, polar(c, Math.PI - 0.4, 3))).toBe(true);
    expect(inFlashlight(open20, 0, c, Math.PI, polar(c, Math.PI - 0.6, 3))).toBe(false);
  });
  it('사거리 8 밖은 안 보인다', () => {
    expect(inFlashlight(open20, 0, { x: 1.5, y: 1.5 }, 0, { x: 9.6, y: 1.5 })).toBe(false);
  });
  it('사거리 8 안쪽은 보인다', () => {
    expect(inFlashlight(open20, 0, { x: 1.5, y: 1.5 }, 0, { x: 1.5 + CONFIG.flashlight.range - 0.1, y: 1.5 })).toBe(true);
  });
  it('벽 뒤는 부채꼴 안이어도 안 보인다', () => {
    // (1.5,3.5)에서 +x 방향, (8.5,3.5)는 사거리 안(7)이지만 x=5 벽에 가려진다.
    expect(inFlashlight(tiny, 0, { x: 1.5, y: 3.5 }, 0, { x: 8.5, y: 3.5 })).toBe(false);
  });
  it('원점과 같은 위치는 보인다', () => {
    expect(inFlashlight(open20, 0, o, 1.2, o)).toBe(true);
  });
});

describe('visibilityPolygon', () => {
  const origin = { x: 1.5, y: 3.5 };

  it('꼭짓점은 반경 안이고 벽을 넘지 않는다(중간 벽을 완전히 막은 맵)', () => {
    const closed = cloneMap(tiny);
    const row = closed.floors[0].rows[1]!;
    closed.floors[0].rows[1] = row.slice(0, 5) + '#' + row.slice(6); // (5,1)도 벽 → x=5 벽이 완전히 막는다
    const poly = visibilityPolygon(closed, 0, origin, 8);
    expect(poly.length).toBeGreaterThan(8);
    expect(poly.every((p) => dist(p, origin) <= 8 + 1e-6)).toBe(true);
    expect(poly.every((p) => p.x <= 5 + 1e-6)).toBe(true); // x=5에 벽
  });

  it('원본 tinyMap에서는 위쪽 틈(y<2)으로만 x=5를 넘는다', () => {
    const poly = visibilityPolygon(tiny, 0, origin, 8);
    expect(poly.every((p) => dist(p, origin) <= 8 + 1e-6)).toBe(true);
    const beyond = poly.filter((p) => p.x > 5 + 1e-6);
    expect(beyond.length).toBeGreaterThan(0); // 틈이 실제로 보인다
    expect(beyond.every((p) => p.y <= 2 + 1e-6)).toBe(true);
  });

  it('모든 꼭짓점이 원점에서 벽에 가리지 않고 보인다', () => {
    const poly = visibilityPolygon(tiny, 0, origin, 8);
    for (const p of poly) {
      const q = { x: origin.x + (p.x - origin.x) * (1 - 1e-6), y: origin.y + (p.y - origin.y) * (1 - 1e-6) };
      expect(hasLineOfSight(tiny, 0, origin, q)).toBe(true);
    }
  });

  it('꼭짓점이 각도 순으로 정렬된다', () => {
    const poly = visibilityPolygon(open20, 0, { x: 10, y: 10 }, 5);
    const angles = poly.map((p) => angleTo({ x: 10, y: 10 }, p));
    // 연속한 꼭짓점 사이 각도 증가분이 항상 0 이상(시계 방향)이어야 한다. ±π 경계는 angleDiff가 감싼다.
    for (let i = 1; i < angles.length; i++) expect(angleDiff(angles[i]!, angles[i - 1]!)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('벽이 없는 곳에서는 반경 원에 가깝다', () => {
    const c = { x: 10, y: 10 };
    const poly = visibilityPolygon(open20, 0, c, 5);
    expect(poly.every((p) => Math.abs(dist(p, c) - 5) < 1e-6)).toBe(true);
    const circle = Math.PI * 25;
    expect(Math.abs(area(poly) - circle) / circle).toBeLessThan(0.02);
  });

  it('벽이 반경보다 가까우면 벽에서 끝난다', () => {
    const c = { x: 10, y: 10 };
    const poly = visibilityPolygon(open20, 0, c, 15); // 바깥 벽(x=1, 19; y=1, 19)이 반경 안
    expect(poly.every((p) => p.x >= 1 - 1e-6 && p.x <= 19 + 1e-6 && p.y >= 1 - 1e-6 && p.y <= 19 + 1e-6)).toBe(true);
  });

  it('블록 모서리 뒤를 지나는 광선을 꼭짓점으로 잡는다', () => {
    const c = { x: 1.5, y: 2.5 };
    const poly = visibilityPolygon(solid2x1, 0, c, 8);
    // 블록 (3..5, 2..3): 왼쪽 면 x=3 앞에서 막히고 모서리 (3,2), (3,3) 근처에 꼭짓점이 있다.
    expect(poly.some((p) => Math.abs(p.x - 3) < 1e-6 && Math.abs(p.y - 2.5) < 1e-6)).toBe(true);
    expect(poly.some((p) => Math.abs(p.x - 3) < 1e-3 && Math.abs(p.y - 2) < 1e-3)).toBe(true);
    expect(poly.some((p) => Math.abs(p.x - 3) < 1e-3 && Math.abs(p.y - 3) < 1e-3)).toBe(true);
    // 블록 안쪽에는 꼭짓점이 없다.
    expect(poly.every((p) => !(p.x > 3 + 1e-3 && p.x < 5 - 1e-3 && p.y > 2 + 1e-3 && p.y < 3 - 1e-3))).toBe(true);
  });

  describe('부채꼴(arc)', () => {
    const c = { x: 10, y: 10 };
    const arc = { aim: 0, angle: Math.PI / 3 };
    const poly = visibilityPolygon(open20, 0, c, 6, arc);

    it('원점에서 시작해 원점으로 끝난다', () => {
      expect(poly[0]).toEqual(c);
      expect(poly[poly.length - 1]).toEqual(c);
    });
    it('나머지 꼭짓점은 부채꼴 안, 반경 위에 있다', () => {
      for (const p of poly.slice(1, -1)) {
        expect(Math.abs(angleDiff(angleTo(c, p), arc.aim))).toBeLessThanOrEqual(arc.angle / 2 + 1e-6);
        expect(dist(p, c)).toBeLessThanOrEqual(6 + 1e-6);
      }
    });
    it('양 끝 경계 방향(±30°)에 꼭짓점이 있다', () => {
      const inner = poly.slice(1, -1);
      const first = inner[0]!;
      const last = inner[inner.length - 1]!;
      expect(angleTo(c, first)).toBeCloseTo(-Math.PI / 6, 6);
      expect(angleTo(c, last)).toBeCloseTo(Math.PI / 6, 6);
    });
    it('넓이가 부채꼴에 가깝다', () => {
      const sector = 0.5 * 36 * (Math.PI / 3);
      expect(Math.abs(area(poly) - sector) / sector).toBeLessThan(0.02);
    });
    it('±π를 가로지르는 조준 방향도 처리한다', () => {
      const p2 = visibilityPolygon(open20, 0, c, 6, { aim: Math.PI, angle: Math.PI / 3 });
      for (const p of p2.slice(1, -1)) {
        expect(Math.abs(angleDiff(angleTo(c, p), Math.PI))).toBeLessThanOrEqual(Math.PI / 6 + 1e-6);
      }
      expect(p2.length).toBeGreaterThan(3);
    });
    it('벽에 가려지면 부채꼴이 벽에서 잘린다', () => {
      const o = { x: 1.5, y: 3.5 };
      const p3 = visibilityPolygon(tiny, 0, o, 8, { aim: 0, angle: Math.PI / 3 });
      // 정면 y=3.5는 x=5 벽에 막힌다. 위쪽 틈을 지나는 광선(y<2)이 없는 범위(±30°는 y=2에서 x=5 기준 −23°)만 확인.
      const mid = p3.slice(1, -1).filter((p) => Math.abs(angleTo(o, p)) < 0.2);
      expect(mid.length).toBeGreaterThan(0);
      expect(mid.every((p) => p.x <= 5 + 1e-6)).toBe(true);
    });
  });
});
