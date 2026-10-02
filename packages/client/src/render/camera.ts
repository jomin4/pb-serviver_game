import { CONFIG } from '@bh/shared';
import type { Vec } from '@bh/shared';

/** 월드 좌표(타일)의 직사각형. */
export type WorldRect = { x: number; y: number; w: number; h: number };

export type Camera = {
  /** 기준 해상도(px). */
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** 기준 px 1개가 차지하는 CSS px. 비율을 유지하며 창에 맞춘 값. */
  readonly scale: number;
  readonly pixelRatio: number;
  /** 캔버스의 CSS 크기(= 기준 해상도 × scale). */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** 캔버스 버퍼 크기(= CSS 크기 × devicePixelRatio, 반올림). */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** 1타일의 CSS px. */
  readonly tileSize: number;
  /** 화면 가운데에 오는 월드 좌표. */
  readonly center: Vec;
  resize(cssW: number, cssH: number, dpr: number): void;
  follow(pos: Vec): void;
  /** 월드(타일) → 캔버스 왼쪽 위 기준 CSS px. */
  worldToScreen(v: Vec): Vec;
  /** 캔버스 왼쪽 위 기준 CSS px → 월드(타일). 마우스 좌표 변환에 쓴다. */
  screenToWorld(v: Vec): Vec;
  /** 지금 화면에 보이는 월드 영역. */
  viewRect(): WorldRect;
};

const positive = (v: number, fallback: number): number => (Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * 기준 해상도(960×540)를 창 크기에 맞춰 비율을 유지하며 확대·축소하는 카메라(스펙 4.1).
 * 화면 좌표는 캔버스 CSS px이다. 그리는 쪽은 `ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)`을 걸고
 * `worldToScreen`으로 얻은 값에 그대로 그린다. DOM에 접근하지 않는다.
 */
export function createCamera(viewW: number = CONFIG.view.width, viewH: number = CONFIG.view.height): Camera {
  let scale = 1;
  let dpr = 1;
  let center: Vec = { x: 0, y: 0 };
  const basePerTile = CONFIG.view.tilePx;

  const cam: Camera = {
    viewWidth: viewW,
    viewHeight: viewH,
    get scale() { return scale; },
    get pixelRatio() { return dpr; },
    get cssWidth() { return viewW * scale; },
    get cssHeight() { return viewH * scale; },
    get pixelWidth() { return Math.max(1, Math.round(viewW * scale * dpr)); },
    get pixelHeight() { return Math.max(1, Math.round(viewH * scale * dpr)); },
    get tileSize() { return basePerTile * scale; },
    get center() { return { x: center.x, y: center.y }; },
    resize(cssW, cssH, ratio) {
      // 크기를 아직 모르는 경우(0) 배율이 0이 되면 역변환이 무한대가 되므로 1로 둔다.
      scale = positive(Math.min(cssW / viewW, cssH / viewH), 1);
      dpr = positive(ratio, 1);
    },
    follow(pos) {
      center = { x: pos.x, y: pos.y };
    },
    worldToScreen(v) {
      const t = basePerTile * scale;
      return { x: (v.x - center.x) * t + (viewW * scale) / 2, y: (v.y - center.y) * t + (viewH * scale) / 2 };
    },
    screenToWorld(v) {
      const t = basePerTile * scale;
      return { x: (v.x - (viewW * scale) / 2) / t + center.x, y: (v.y - (viewH * scale) / 2) / t + center.y };
    },
    viewRect() {
      const w = viewW / basePerTile;
      const h = viewH / basePerTile;
      return { x: center.x - w / 2, y: center.y - h / 2, w, h };
    },
  };
  return cam;
}
