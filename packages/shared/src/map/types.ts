import type { FloorId, Vec } from '../types.ts';

export type TileKind = 'wall' | 'floor' | 'pillar' | 'car' | 'stairs';
export type FloorData = { width: number; height: number; rows: string[] }; // '#'=wall '.'=floor 'P'=pillar 'C'=car 'S'=stairs
export type Rect = { x: number; y: number; w: number; h: number };          // 타일 단위
export type MapData = { id: string; floors: [FloorData, FloorData];
  truckZone: Rect;                                   // B1
  spawns: Vec[];                                     // B1, truckZone 안, 4개
  itemSlots: { floor: FloorId; pos: Vec }[];
  patrolRoutes: { floor: FloorId; points: Vec[] }[]; // 층마다 최소 1개
  lights: { id: string; floor: FloorId; pos: Vec; radius: number; flickering: boolean }[];
  stairs: { a: { floor: FloorId; tile: Vec }; b: { floor: FloorId; tile: Vec } }[];
  zones: { name: string; floor: FloorId; rect: Rect }[] };
