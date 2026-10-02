import { CONFIG, tileAt } from '@bh/shared';
import type { FloorId, MapData, TileKind } from '@bh/shared';

/**
 * 층별 맵 그림(스펙 4.2의 1번). 층마다 한 번 오프스크린 캔버스에 기준 해상도(1타일 = `CONFIG.view.tilePx`)로
 * 그려 두고 매 프레임 필요한 부분만 잘라 쓴다.
 */
export type MapLayer = {
  /** 층 그림. 처음 요청할 때 그린다. */
  canvas(floor: FloorId): HTMLCanvasElement;
  /** 1타일의 캐시 px. */
  readonly tilePx: number;
};

const COLOR: Record<TileKind, string> = {
  floor: '#2a2c31',
  wall: '#0c0d10',
  pillar: '#56595f',
  car: '#343945',
  stairs: '#3a3d45',
};

export function createMapLayer(map: MapData, makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): MapLayer {
  const T = CONFIG.view.tilePx;
  const cache: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];

  const build = (floor: FloorId): HTMLCanvasElement => {
    const { width, height } = map.floors[floor];
    const canvas = makeCanvas();
    canvas.width = width * T;
    canvas.height = height * T;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const kind = (x: number, y: number): TileKind => tileAt(map, floor, x, y);

    ctx.fillStyle = COLOR.wall;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = kind(x, y);
        const px = x * T;
        const py = y * T;
        // 기둥·차·계단 아래에도 바닥을 깐다
        if (k !== 'wall') {
          ctx.fillStyle = COLOR.floor;
          ctx.fillRect(px, py, T, T);
          ctx.strokeStyle = 'rgba(255,255,255,0.03)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        }
        if (k === 'pillar') {
          ctx.fillStyle = COLOR.pillar;
          ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
          ctx.strokeStyle = '#2b2d31';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 3, py + 3, T - 6, T - 6);
        } else if (k === 'car') {
          ctx.fillStyle = COLOR.car;
          ctx.fillRect(px, py, T, T);
          // 차 덩어리의 바깥 테두리만 긋는다
          ctx.strokeStyle = '#59606f';
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (kind(x, y - 1) !== 'car') { ctx.moveTo(px, py + 1); ctx.lineTo(px + T, py + 1); }
          if (kind(x, y + 1) !== 'car') { ctx.moveTo(px, py + T - 1); ctx.lineTo(px + T, py + T - 1); }
          if (kind(x - 1, y) !== 'car') { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + T); }
          if (kind(x + 1, y) !== 'car') { ctx.moveTo(px + T - 1, py); ctx.lineTo(px + T - 1, py + T); }
          ctx.stroke();
        } else if (k === 'stairs') {
          ctx.fillStyle = COLOR.stairs;
          ctx.fillRect(px, py, T, T);
          ctx.strokeStyle = '#6b6f7a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 1; i < 5; i++) { ctx.moveTo(px + 3, py + (i * T) / 5); ctx.lineTo(px + T - 3, py + (i * T) / 5); }
          ctx.stroke();
        } else if (k === 'wall') {
          // 바닥과 닿는 벽 가장자리를 조금 밝게
          ctx.strokeStyle = '#1d1f25';
          ctx.lineWidth = 3;
          ctx.beginPath();
          if (kind(x, y + 1) !== 'wall' && y + 1 < height) { ctx.moveTo(px, py + T - 1.5); ctx.lineTo(px + T, py + T - 1.5); }
          if (kind(x, y - 1) !== 'wall' && y > 0) { ctx.moveTo(px, py + 1.5); ctx.lineTo(px + T, py + 1.5); }
          if (kind(x + 1, y) !== 'wall' && x + 1 < width) { ctx.moveTo(px + T - 1.5, py); ctx.lineTo(px + T - 1.5, py + T); }
          if (kind(x - 1, y) !== 'wall' && x > 0) { ctx.moveTo(px + 1.5, py); ctx.lineTo(px + 1.5, py + T); }
          ctx.stroke();
        }
      }
    }
    // 구역 이름(흐리게)
    ctx.font = `600 ${Math.round(T * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(220,220,230,0.18)';
    for (const z of map.zones) {
      if (z.floor !== floor) continue;
      ctx.fillText(z.name, (z.rect.x + z.rect.w / 2) * T, (z.rect.y + z.rect.h / 2) * T);
    }
    return canvas;
  };

  return {
    tilePx: T,
    canvas(floor) {
      let c = cache[floor];
      if (!c) { c = build(floor); cache[floor] = c; }
      return c;
    },
  };
}
