import { isSolid, tileAt } from '../../src/map/grid.ts';
import type { MapData } from '../../src/map/types.ts';
import type { FloorId, Vec } from '../../src/types.ts';

/** moveCircle과 같은 기준(닿기만 하는 것은 겹침이 아님)으로 원이 단단한 칸과 겹치는지 본다. */
export function overlapsSolid(map: MapData, floor: FloorId, c: Vec, r: number): boolean {
  for (let ty = Math.floor(c.y - r); ty <= Math.floor(c.y + r); ty++) {
    for (let tx = Math.floor(c.x - r); tx <= Math.floor(c.x + r); tx++) {
      if (!isSolid(tileAt(map, floor, tx, ty))) continue;
      const nx = Math.max(tx, Math.min(c.x, tx + 1));
      const ny = Math.max(ty, Math.min(c.y, ty + 1));
      if (Math.hypot(c.x - nx, c.y - ny) < r - 1e-9) return true;
    }
  }
  return false;
}
