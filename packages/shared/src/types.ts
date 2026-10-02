// packages/shared/src/types.ts
export type Vec = { x: number; y: number };
export type FloorId = 0 | 1;                       // 0 = B1, 1 = B2
export type PlayerInput = {
  seq: number;
  move: Vec;                                       // 길이 ≤ 1
  run: boolean;
  aim: number;                                     // 라디안
  toggleFlashlight: boolean;                       // 이번 입력에서 눌림(엣지)
  interact: boolean;                               // 누르고 있는 상태(레벨)
  drop: boolean;                                   // 엣지
  selectSlot: 0 | 1 | 2 | null;
  ping: Vec | null;                                // 월드 좌표, 자기 층
  chat: 0 | 1 | 2 | 3 | 4 | 5 | null;
  flicker: boolean;                                // 유령 전용, 엣지
};
export type PlayerState = {
  id: string; name: string; pos: Vec; floor: FloorId; aim: number;
  flashlightOn: boolean; battery: number; hp: number; stamina: number;
  alive: boolean;                                  // false면 유령
  inventory: string[];                             // item id, 최대 3
  selectedSlot: 0 | 1 | 2; lastSeq: number; interactHeld: number; // 초
  prevInteract: boolean; onStairs: boolean;
  exhausted: boolean;                              // 스태미나가 바닥나 회복될 때까지 뛰지 못함
  connected: boolean;
  cooldowns: { flicker: number; ping: number; chat: number };
  carriedTotal: number;                            // 결과 화면용 운반 누계
};
export type ItemState = { id: string; kind: string; value: number; weight: number;
  pos: Vec; floor: FloorId; carriedBy: string | null; loaded: boolean };
export type StalkerMode = 'patrol' | 'investigate' | 'chase' | 'search' | 'retreat';
export type StalkerState = { id: string; floor: FloorId; pos: Vec; mode: StalkerMode;
  targetId: string | null; goal: Vec | null; timer: number; patrolIndex: number;
  routeIndex: number; path: Vec[] };
export type WatcherState = { id: string; floor: FloorId; pos: Vec; active: boolean;
  frozen: boolean; moving: boolean; path: { floor: FloorId; pos: Vec }[]; waitTimer: number };
export type LightState = { id: string; floor: FloorId; pos: Vec; radius: number;
  on: boolean; flickering: boolean; flickerUntil: number };
export type RoundPhase = 'playing' | 'success' | 'fail';
export type RoundState = { clock: number; target: number; truckTotal: number;
  phase: RoundPhase; watcherSpawned: boolean; lightsHalved: boolean; horned: boolean };
export type GameEvent =
  | { type: 'chat'; playerId: string; index: number }
  | { type: 'ping'; playerId: string; floor: FloorId; pos: Vec }
  | { type: 'flicker'; lightIds: string[] }
  | { type: 'damage'; playerId: string }
  | { type: 'death'; playerId: string; cause: 'stalker' | 'watcher' | 'left_behind' | 'disconnect' }
  | { type: 'horn' }
  | { type: 'noise'; floor: FloorId; pos: Vec; radius: number }
  | { type: 'roundEnd'; phase: 'success' | 'fail' };
export type World = { tick: number; time: number; seed: number; rngState: number;
  mapId: string; playerCount: number; players: Record<string, PlayerState>;
  items: Record<string, ItemState>; stalkers: StalkerState[]; watcher: WatcherState;
  lights: LightState[]; round: RoundState; events: GameEvent[] };
