import { CONFIG, ITEM_KINDS } from '@bh/shared';
import type { ItemState, Rect } from '@bh/shared';
import type { Camera } from './camera.ts';
import type { MonsterView, RenderPlayer } from './visibility.ts';

/**
 * 엔티티 종류 → 그리기 함수(스펙 4.2). 스프라이트로 바꿀 때는 이 표만 고친다.
 * 모든 함수는 CSS px 좌표계(`ctx`에 devicePixelRatio 변환이 걸린 상태)에서 `cam.worldToScreen`으로 그린다.
 */
export type DrawEntities = {
  player: RenderPlayer;
  ghost: RenderPlayer;
  stalker: MonsterView;
  watcher: MonsterView;
  item: ItemState;
  truck: Rect;
};
export type DrawKind = keyof DrawEntities;
export type DrawFn<K extends DrawKind> = (ctx: CanvasRenderingContext2D, e: DrawEntities[K], cam: Camera) => void;

/** 플레이어 색(로비 견본 .c0~.c3과 같다). */
export const PLAYER_COLORS = ['#e5655d', '#5da9e5', '#6fcf8a', '#d9a441'] as const;
const ITEM_COLORS = ['#8d8f94', '#c27a3a', '#5f7f9c', '#b9b4a6', '#8c5a3c'] as const;

export const playerColor = (index: number): string => PLAYER_COLORS[((index % 4) + 4) % 4]!;

function nameLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.font = `600 ${Math.max(10, Math.round(size))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#f2f2f5';
  ctx.fillText(text, x, y);
}

const drawPlayer: DrawFn<'player'> = (ctx, p, cam) => {
  const c = cam.worldToScreen(p.pos);
  const r = CONFIG.player.radius * cam.tileSize;
  ctx.fillStyle = playerColor(p.colorIndex);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  // 방향 표시: 조준 방향의 작은 삼각형
  const tip = { x: c.x + Math.cos(p.aim) * r * 1.6, y: c.y + Math.sin(p.aim) * r * 1.6 };
  const side = r * 0.55;
  const bx = c.x + Math.cos(p.aim) * r * 0.9;
  const by = c.y + Math.sin(p.aim) * r * 0.9;
  ctx.fillStyle = '#f2f2f5';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bx + Math.cos(p.aim + Math.PI / 2) * side, by + Math.sin(p.aim + Math.PI / 2) * side);
  ctx.lineTo(bx + Math.cos(p.aim - Math.PI / 2) * side, by + Math.sin(p.aim - Math.PI / 2) * side);
  ctx.closePath();
  ctx.fill();
  nameLabel(ctx, p.name, c.x, c.y - r * 1.4, cam.tileSize * 0.38);
};

const drawGhost: DrawFn<'ghost'> = (ctx, p, cam) => {
  const c = cam.worldToScreen(p.pos);
  const r = CONFIG.player.radius * cam.tileSize;
  ctx.save();
  ctx.globalAlpha = CONFIG.fx.ghostAlpha;
  ctx.fillStyle = '#dfe6f2';
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.strokeStyle = playerColor(p.colorIndex);
  ctx.stroke();
  nameLabel(ctx, p.name, c.x, c.y - r * 1.4, cam.tileSize * 0.34);
  ctx.restore();
};

const drawStalker: DrawFn<'stalker'> = (ctx, m, cam) => {
  const c = cam.worldToScreen(m.pos);
  const s = CONFIG.stalker.radius * cam.tileSize;
  ctx.fillStyle = '#5a0d12';
  ctx.fillRect(c.x - s, c.y - s, s * 2, s * 2);
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.strokeStyle = '#a3222b';
  ctx.strokeRect(c.x - s, c.y - s, s * 2, s * 2);
};

const drawWatcher: DrawFn<'watcher'> = (ctx, m, cam) => {
  const c = cam.worldToScreen(m.pos);
  const r = CONFIG.watcher.radius * cam.tileSize;
  ctx.fillStyle = '#e8e6df';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r * 0.65, r * 1.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.strokeStyle = 'rgba(80,80,90,0.9)';
  ctx.stroke();
};

const drawItem: DrawFn<'item'> = (ctx, it, cam) => {
  const c = cam.worldToScreen(it.pos);
  const kindIndex = Math.max(0, (ITEM_KINDS as readonly string[]).indexOf(it.kind));
  // 무거울수록 조금 크게
  const t = (it.weight - CONFIG.items.weightMin) / (CONFIG.items.weightMax - CONFIG.items.weightMin);
  const s = cam.tileSize * (0.18 + 0.1 * Math.min(1, Math.max(0, t)));
  ctx.fillStyle = ITEM_COLORS[kindIndex % ITEM_COLORS.length]!;
  ctx.fillRect(c.x - s, c.y - s, s * 2, s * 2);
  ctx.lineWidth = Math.max(1, s * 0.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeRect(c.x - s, c.y - s, s * 2, s * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(c.x - s, c.y - s, s * 2, s * 0.5);
};

const drawTruck: DrawFn<'truck'> = (ctx, z, cam) => {
  const a = cam.worldToScreen({ x: z.x, y: z.y });
  const w = z.w * cam.tileSize;
  const h = z.h * cam.tileSize;
  ctx.save();
  ctx.fillStyle = 'rgba(217,164,65,0.10)';
  ctx.fillRect(a.x, a.y, w, h);
  ctx.setLineDash([cam.tileSize * 0.3, cam.tileSize * 0.2]);
  ctx.lineWidth = Math.max(1, cam.tileSize * 0.08);
  ctx.strokeStyle = 'rgba(217,164,65,0.8)';
  ctx.strokeRect(a.x, a.y, w, h);
  ctx.setLineDash([]);
  // 출입구 쪽(구역 왼편)에 세운 트럭 짐칸
  const bodyW = cam.tileSize * 0.9;
  ctx.fillStyle = '#3d4a5c';
  ctx.fillRect(a.x - bodyW * 0.15, a.y + h * 0.15, bodyW, h * 0.7);
  ctx.strokeStyle = '#8fa3bf';
  ctx.strokeRect(a.x - bodyW * 0.15, a.y + h * 0.15, bodyW, h * 0.7);
  ctx.font = `700 ${Math.max(10, Math.round(cam.tileSize * 0.4))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(217,164,65,0.9)';
  ctx.fillText('트럭', a.x + w / 2, a.y + cam.tileSize * 0.15);
  ctx.restore();
};

export const DRAW_TABLE: { [K in DrawKind]: DrawFn<K> } = {
  player: drawPlayer,
  ghost: drawGhost,
  stalker: drawStalker,
  watcher: drawWatcher,
  item: drawItem,
  truck: drawTruck,
};
