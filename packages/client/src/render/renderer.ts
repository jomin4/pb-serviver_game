import { CONFIG, dist } from '@bh/shared';
import type { MapData, Vec } from '@bh/shared';
import type { Camera } from './camera.ts';
import { DRAW_TABLE } from './drawTable.ts';
import { createDarkness } from './lighting.ts';
import { createMapLayer } from './mapLayer.ts';
import { litAreas, visibleEntities } from './visibility.ts';
import type { RenderSnapshot } from './visibility.ts';

export type Renderer = {
  /** 한 프레임. 카메라를 내 캐릭터(유령이면 유령)에 맞추고 스펙 4.2 순서로 그린다. */
  draw(snap: RenderSnapshot): void;
  /** 피격 흔들림을 시작한다(`CONFIG.fx.shakeSeconds`). */
  shake(): void;
};

const PING_COLOR = '#ffd36b';
const TWO_PI = Math.PI * 2;

/**
 * 그리는 순서(스펙 4.2): 맵(층별 오프스크린 캐시) → 트럭 구역 → 폐품 → 캐릭터 → 어둠 → 효과
 * (핑, 화면 밖 핑 화살표, 위험 비네트, 체력 1 붉은 가장자리). 피격 흔들림은 카메라 중심을 흔든다.
 * 시야 다각형은 화면(+여유) 안의 광원만 계산하고, 움직이지 않는 광원의 다각형은 재사용한다.
 */
export function createRenderer(canvas: HTMLCanvasElement, map: MapData, cam: Camera): Renderer {
  const ctx = canvas.getContext('2d');
  const mapLayer = createMapLayer(map);
  const darkness = createDarkness();
  let shakeUntil = 0;
  const clockSeconds = (): number => performance.now() / 1000;

  function drawMap(c: CanvasRenderingContext2D, floor: 0 | 1): void {
    const layer = mapLayer.canvas(floor);
    const T = mapLayer.tilePx;
    const { width, height } = map.floors[floor];
    const view = cam.viewRect();
    const x0 = Math.max(0, view.x);
    const y0 = Math.max(0, view.y);
    const x1 = Math.min(width, view.x + view.w);
    const y1 = Math.min(height, view.y + view.h);
    if (x1 <= x0 || y1 <= y0) return;
    const a = cam.worldToScreen({ x: x0, y: y0 });
    const b = cam.worldToScreen({ x: x1, y: y1 });
    c.drawImage(layer, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T, a.x, a.y, b.x - a.x, b.y - a.y);
  }

  function drawPings(c: CanvasRenderingContext2D, snap: RenderSnapshot, now: number): void {
    const w = cam.cssWidth;
    const h = cam.cssHeight;
    const margin = cam.tileSize * 0.6;
    for (const ping of snap.pings) {
      if (ping.floor !== snap.self.floor || ping.until <= snap.time) continue;
      const p = cam.worldToScreen(ping.pos);
      const onScreen = p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
      c.save();
      c.strokeStyle = PING_COLOR;
      c.fillStyle = PING_COLOR;
      if (onScreen) {
        const phase = (now * 1.5) % 1;
        c.globalAlpha = 1 - phase;
        c.lineWidth = Math.max(2, cam.tileSize * 0.08);
        c.beginPath();
        c.arc(p.x, p.y, cam.tileSize * (0.25 + 0.6 * phase), 0, TWO_PI);
        c.stroke();
        c.globalAlpha = 1;
        c.beginPath();
        c.arc(p.x, p.y, cam.tileSize * 0.12, 0, TWO_PI);
        c.fill();
      } else {
        // 화면 가운데에서 핑 쪽으로 그은 선이 가장자리와 만나는 곳에 화살표
        const cx = w / 2;
        const cy = h / 2;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const k = Math.min(Math.abs((cx - margin) / (dx || 1e-9)), Math.abs((cy - margin) / (dy || 1e-9)));
        const ax = cx + dx * k;
        const ay = cy + dy * k;
        const ang = Math.atan2(dy, dx);
        const s = cam.tileSize * 0.45;
        c.translate(ax, ay);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(s, 0);
        c.lineTo(-s * 0.6, s * 0.6);
        c.lineTo(-s * 0.6, -s * 0.6);
        c.closePath();
        c.fill();
      }
      c.restore();
    }
  }

  function edgeGlow(c: CanvasRenderingContext2D, color: string, inner: number): void {
    const w = cam.cssWidth;
    const h = cam.cssHeight;
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function nearMonster(snap: RenderSnapshot): boolean {
    const self = snap.self;
    return snap.monsters.some((m) => m.active && m.floor === self.floor && dist(m.pos, self.pos) <= CONFIG.fx.dangerDistance);
  }

  return {
    shake() {
      shakeUntil = clockSeconds() + CONFIG.fx.shakeSeconds;
    },
    draw(snap) {
      if (!ctx) return;
      const now = clockSeconds();
      const self = snap.self;
      const floor = self.floor;

      let center: Vec = self.pos;
      if (now < shakeUntil) {
        const k = ((shakeUntil - now) / CONFIG.fx.shakeSeconds) * CONFIG.fx.shakeTiles;
        center = { x: center.x + Math.sin(now * 97) * k, y: center.y + Math.cos(now * 83) * k };
      }
      cam.follow(center);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(cam.pixelRatio, 0, 0, cam.pixelRatio, 0, 0);

      // 1. 맵
      drawMap(ctx, floor);
      if (floor === 0) DRAW_TABLE.truck(ctx, map.truckZone, cam);

      const areas = litAreas(snap, map, cam.viewRect());
      const vis = visibleEntities(snap, map, areas);

      // 2. 폐품
      for (const it of vis.items) DRAW_TABLE.item(ctx, it, cam);
      // 3. 캐릭터: 몬스터 → 다른 플레이어 → 나(맨 위)
      for (const m of vis.monsters) {
        if (m.kind === 'watcher') DRAW_TABLE.watcher(ctx, m, cam);
        else DRAW_TABLE.stalker(ctx, m, cam);
      }
      const players = vis.players.slice().sort((a, b) => Number(a.id === snap.selfId) - Number(b.id === snap.selfId));
      for (const p of players) {
        if (p.alive) DRAW_TABLE.player(ctx, p, cam);
        else DRAW_TABLE.ghost(ctx, p, cam);
      }

      // 4. 어둠
      darkness.draw(ctx, cam, areas, self.alive ? CONFIG.fx.darknessAlpha : CONFIG.fx.ghostDarknessAlpha);

      // 5. 효과
      drawPings(ctx, snap, now);
      if (self.alive && nearMonster(snap)) {
        const pulse = 0.55 + 0.2 * Math.sin(now * 2 * Math.PI * 1.2);
        edgeGlow(ctx, `rgba(40,0,0,${pulse.toFixed(3)})`, 0.25);
      }
      if (self.alive && self.hp === 1) edgeGlow(ctx, 'rgba(170,0,0,0.45)', 0.3);
    },
  };
}
