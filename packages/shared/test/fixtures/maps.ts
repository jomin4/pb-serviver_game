import type { MapData } from '../../src/map/types.ts';

/** 맵을 깊은 복사한다. 테스트가 원본 맵 데이터를 오염시키지 않도록 쓴다. */
export function cloneMap(map: MapData): MapData {
  return JSON.parse(JSON.stringify(map)) as MapData;
}
