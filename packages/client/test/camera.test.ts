import { describe, expect, it } from 'vitest';
import { CONFIG } from '@bh/shared';
import { createCamera } from '../src/render/camera.ts';

describe('camera', () => {
  it('카메라: 1920×1080 창에서 960×540은 2배, 좌표 왕복 변환이 일치', () => {
    const cam = createCamera(960, 540);
    cam.resize(1920, 1080, 1);
    expect(cam.scale).toBe(2);
    expect(cam.cssWidth).toBe(1920);
    expect(cam.cssHeight).toBe(1080);
    cam.follow({ x: 10, y: 5 });
    // 따라가는 점은 화면 가운데
    expect(cam.worldToScreen({ x: 10, y: 5 })).toEqual({ x: 960, y: 540 });
    // 1타일 = 기준 32px → 2배면 64px
    expect(cam.worldToScreen({ x: 11, y: 5 }).x).toBeCloseTo(960 + CONFIG.view.tilePx * 2);
    for (const v of [{ x: 3.25, y: 7.75 }, { x: -2, y: 40 }, { x: 10, y: 5 }]) {
      const back = cam.screenToWorld(cam.worldToScreen(v));
      expect(back.x).toBeCloseTo(v.x, 9);
      expect(back.y).toBeCloseTo(v.y, 9);
    }
    for (const s of [{ x: 0, y: 0 }, { x: 1919, y: 1079 }, { x: 123.5, y: 456.25 }]) {
      const back = cam.worldToScreen(cam.screenToWorld(s));
      expect(back.x).toBeCloseTo(s.x, 9);
      expect(back.y).toBeCloseTo(s.y, 9);
    }
  });

  it('기본 기준 해상도는 960×540', () => {
    const cam = createCamera();
    cam.resize(960, 540, 1);
    expect(cam.scale).toBe(1);
    expect(cam.viewWidth).toBe(960);
    expect(cam.viewHeight).toBe(540);
  });

  it('비율을 유지한다: 넓은 창은 높이에 맞춘다', () => {
    const cam = createCamera(960, 540);
    cam.resize(2400, 1080, 1);
    expect(cam.scale).toBe(2);
    expect(cam.cssWidth).toBe(1920);
    expect(cam.cssHeight).toBe(1080);
  });

  it('비율을 유지한다: 좁은 창은 너비에 맞춘다', () => {
    const cam = createCamera(960, 540);
    cam.resize(480, 900, 1);
    expect(cam.scale).toBe(0.5);
    expect(cam.cssWidth).toBe(480);
    expect(cam.cssHeight).toBe(270);
  });

  it('devicePixelRatio만큼 캔버스 픽셀을 늘리고 화면 좌표(CSS px)는 그대로', () => {
    const cam = createCamera(960, 540);
    cam.resize(1920, 1080, 2);
    expect(cam.scale).toBe(2);
    expect(cam.pixelRatio).toBe(2);
    expect(cam.pixelWidth).toBe(3840);
    expect(cam.pixelHeight).toBe(2160);
    cam.follow({ x: 0, y: 0 });
    expect(cam.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 960, y: 540 });
  });

  it('보이는 월드 영역(타일)', () => {
    const cam = createCamera(960, 540);
    cam.resize(1920, 1080, 1);
    cam.follow({ x: 20, y: 10 });
    const r = cam.viewRect();
    // 960/32 = 30타일 × 540/32 = 16.875타일, 배율과 무관
    expect(r.w).toBeCloseTo(30);
    expect(r.h).toBeCloseTo(16.875);
    expect(r.x).toBeCloseTo(5);
    expect(r.y).toBeCloseTo(10 - 16.875 / 2);
  });

  it('크기가 0이거나 잘못되면 배율이 0이 되지 않는다', () => {
    const cam = createCamera(960, 540);
    cam.resize(0, 0, 0);
    expect(cam.scale).toBeGreaterThan(0);
    expect(cam.pixelRatio).toBeGreaterThan(0);
    const v = cam.screenToWorld({ x: 1, y: 1 });
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
});
