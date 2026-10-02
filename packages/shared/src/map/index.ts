import data from './parking-lot.json' with { type: 'json' };
import type { MapData } from './types.ts';

export type { FloorData, MapData, Rect, TileKind } from './types.ts';

export const MAP_IDS = ['parking-lot'] as const;

const MAPS: Record<string, MapData> = {
  'parking-lot': data as unknown as MapData,
};

/** id에 해당하는 맵 데이터. 읽기 전용으로 다룬다. 모르는 id면 throw. */
export function getMap(id: string): MapData {
  const map = MAPS[id];
  if (!map) throw new Error(`unknown map id: ${id}`);
  return map;
}
