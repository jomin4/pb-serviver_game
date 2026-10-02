import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';

export const RECONNECT_KEY = 'bh.reconnect';

const MSG = {
  unreachable: '서버에 연결할 수 없습니다',
  notFound: '방을 찾을 수 없습니다. 코드를 확인해 주세요',
  full: '방이 가득 찼습니다',
  inProgress: '게임이 진행 중입니다. 끝나면 다시 시도해 주세요',
  version: '새 버전이 있습니다. 새로고침해 주세요',
  badNickname: '닉네임은 1~10자로 입력해 주세요',
} as const;

/** 입장 실패 오류를 화면 문구로 바꾼다. 코드 없는 오류는 연결 실패로 본다. */
export function joinErrorMessage(err: unknown): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; message?: unknown };
  switch (e.code) {
    case 4001: return MSG.full;
    case 4002: return MSG.version;
    case 4003: return MSG.inProgress;
    case 4004: return MSG.badNickname;
  }
  if (typeof e.message === 'string' && e.message.includes('not found')) return MSG.notFound;
  return MSG.unreachable;
}

/** 서버 주소. 환경 변수가 있으면 그것, 없으면 페이지와 같은 출처(https면 wss). */
export function resolveServerUrl(envUrl: string | undefined, loc: { protocol: string; host: string }): string {
  if (envUrl) return envUrl;
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}`;
}

export function serverUrl(): string {
  return resolveServerUrl(import.meta.env.VITE_SERVER_URL, location);
}

// 상태 형식은 서버 스키마(리플렉션)로 디코딩된다. 화면이 읽는 필드만 구조적으로 선언한다.
export type PlayerView = {
  id: string; name: string; isHost: boolean; joinOrder: number; colorIndex: number;
  connected: boolean; alive: boolean; carriedTotal: number;
};
export type RoomView = {
  phase: string; hostId: string; result: string; clock: number; target: number; truckTotal: number;
  players: { forEach(cb: (p: PlayerView, key: string) => void): void; size: number };
};
export type GameRoom = Room<RoomView>;

const client = (): Client => new Client(serverUrl());

/**
 * SDK의 자동 재접속(지수 백오프, 최대 15회)은 끈다. 재접속은 `reconnectLoop`가 20초 동안 2초 간격으로 맡는다.
 * 끄면 비정상 종료도 `onLeave`로 올라오므로 화면 쪽은 한 곳에서만 처리하면 된다.
 */
function adopt(room: GameRoom): GameRoom {
  room.reconnection.enabled = false;
  saveReconnectToken(room.reconnectionToken);
  return room;
}

/** 재접속 토큰 저장소. sessionStorage가 막혀 있어도 던지지 않는다. */
export function saveReconnectToken(token: string): void {
  try { sessionStorage.setItem(RECONNECT_KEY, token); } catch { /* 저장소를 못 쓰면 재접속만 포기한다 */ }
}
export function loadReconnectToken(): string | null {
  try { return sessionStorage.getItem(RECONNECT_KEY); } catch { return null; }
}
export function clearReconnectToken(): void {
  try { sessionStorage.removeItem(RECONNECT_KEY); } catch { /* 무시 */ }
}

function joinOptions(name: string): { name: string; version: string } {
  return { name, version: __GAME_VERSION__ };
}

export async function createRoom(name: string): Promise<GameRoom> {
  return adopt(await client().create<RoomView>('round', joinOptions(name)));
}

export async function joinRoom(code: string, name: string): Promise<GameRoom> {
  return adopt(await client().joinById<RoomView>(code, joinOptions(name)));
}

export async function reconnect(token: string): Promise<GameRoom> {
  return adopt(await client().reconnect<RoomView>(token));
}

export type ReconnectLoopOptions<R> = {
  attempt: () => Promise<R>;
  /** 전체 제한 시간(초). */
  seconds: number;
  /** 실패한 시도의 끝에서 다음 시도까지의 간격(ms). */
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** 매초 남은 시간(초, 올림)을 알린다. */
  onTick: (secondsLeft: number) => void;
};

/**
 * 제한 시간 안에 `attempt`가 성공할 때까지 반복한다. 성공하면 그 값, 시간이 다 되었거나
 * 방이 없다는 오류(서버가 재시작되어 자리가 사라짐)면 null.
 */
export async function reconnectLoop<R>(opts: ReconnectLoopOptions<R>): Promise<R | null> {
  const start = opts.now();
  const elapsed = (): number => (opts.now() - start) / 1000;
  let nextAttemptAt = 0;
  for (;;) {
    if (elapsed() >= opts.seconds) return null;
    opts.onTick(Math.ceil(opts.seconds - elapsed()));
    if (elapsed() >= nextAttemptAt) {
      try {
        return await opts.attempt();
      } catch (err) {
        if (joinErrorMessage(err) === MSG.notFound) return null;
      }
      nextAttemptAt = elapsed() + opts.intervalMs / 1000;
    }
    await opts.sleep(1000);
  }
}
