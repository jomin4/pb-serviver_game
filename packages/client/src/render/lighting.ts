import { CONFIG } from '@bh/shared';
import type { Camera } from './camera.ts';
import type { LitArea } from './visibility.ts';

/**
 * 어둠 레이어(스펙 4.2의 4번, 4.3). 화면 크기의 별도 캔버스를 `alpha`의 검정으로 채우고, 빛 영역 다각형을
 * `destination-out`으로 뚫는다. 다각형은 광원 중심의 방사형 그라데이션으로 채워 가장자리가 흐리다.
 * 다 만든 레이어를 화면 캔버스 위에 한 번에 얹는다.
 */
export type Darkness = {
  draw(target: CanvasRenderingContext2D, cam: Camera, areas: LitArea[], alpha: number): void;
};

export function createDarkness(makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): Darkness {
  const layer = makeCanvas();
  const ctx = layer.getContext('2d');

  return {
    draw(target, cam, areas, alpha) {
      if (!ctx) return;
      if (layer.width !== cam.pixelWidth || layer.height !== cam.pixelHeight) {
        layer.width = cam.pixelWidth;
        layer.height = cam.pixelHeight;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, layer.width, layer.height);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, 0, layer.width, layer.height);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.setTransform(cam.pixelRatio, 0, 0, cam.pixelRatio, 0, 0);
      const soft = CONFIG.fx.lightSoftEdge;
      for (const { source, poly } of areas) {
        if (poly.length < 3) continue;
        const c = cam.worldToScreen(source.pos);
        const r = source.radius * cam.tileSize;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(soft, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        const first = cam.worldToScreen(poly[0]!);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < poly.length; i++) {
          const p = cam.worldToScreen(poly[i]!);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      target.save();
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.drawImage(layer, 0, 0);
      target.restore();
    },
  };
}
