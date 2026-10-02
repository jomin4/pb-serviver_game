import './styles.css';
import { CONFIG } from '@bh/shared';
import {
  clearReconnectToken, createRoom, joinErrorMessage, joinRoom, loadReconnectToken, reconnect, reconnectLoop,
} from './net/connection.ts';
import type { GameRoom } from './net/connection.ts';
import { inviteLink, roomFromUrl } from './net/url.ts';
import { startGame } from './game.ts';
import type { GameSession } from './game.ts';
import {
  hideReconnecting, showError, showGame, showHome, showLobby, showNotice, showReconnecting, showResult,
} from './ui/screens.ts';

/** 첫 화면 → (방 만들기/입장) → 대기실 → 게임 → 결과 → 대기실('한 판 더'). 방 단계는 서버 상태(phase)가 정한다. */

const RECONNECT_INTERVAL_MS = 2000;
const CONNECTION_LOST = '연결이 끊겼습니다';

let room: GameRoom | null = null;
/** 라운드 진행 중인 게임 화면. 게임 화면을 떠나면(단계 변경, 연결 끊김, 나가기) 멈춘다. */
let game: GameSession | null = null;
/** 마지막으로 그린 화면의 식별 값. 같으면 다시 그리지 않는다(링크 선택 같은 화면 상태를 지키려고). */
let drawn = '';
let busy = false;
let recovering = false;
/** 이 클라이언트가 스스로 나가는 중이면 true. onLeave를 연결 끊김으로 보지 않는다. */
let leaving = false;

const presetCode = roomFromUrl(location.href);

function stopGame(): void {
  game?.stop();
  game = null;
}

function resetSession(): void {
  stopGame();
  room = null;
  drawn = '';
  clearReconnectToken();
}

function goHome(prev: { name?: string; code?: string } = {}): void {
  resetSession();
  showHome(
    (name) => void enter(name, undefined, () => createRoom(name)),
    (code, name) => void enter(name, code, () => joinRoom(code, name)),
    { presetCode, ...prev },
  );
}

async function enter(name: string, code: string | undefined, connect: () => Promise<GameRoom>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    bind(await connect());
  } catch (err) {
    showError(joinErrorMessage(err), () => goHome({ name, code }));
  } finally {
    busy = false;
  }
}

function bind(next: GameRoom): void {
  room = next;
  drawn = '';
  leaving = false;
  next.onStateChange(() => {
    if (room !== next) return;
    render(next);
    game?.onState();
  });
  next.onMessage('roundError', (msg: { message?: string }) => {
    if (room === next) showNotice(msg?.message ?? '오류로 라운드가 종료되었습니다');
  });
  // 게임 중 이벤트(퀵챗, 핑, 피격, 경적 등)는 게임 화면이 처리한다.
  next.onMessage('event', (e: unknown) => { if (room === next) game?.onEvent(e); });
  next.onError((code, message) => console.warn('room error', code, message));
  next.onLeave((code) => { if (room === next && !leaving) void onUnexpectedLeave(next, code); });
  render(next);
}

function leave(): void {
  const current = room;
  if (!current) return;
  leaving = true;
  void current.leave(true).catch(() => {});
  goHome();
}

function render(r: GameRoom): void {
  const state = r.state;
  // 재접속 직후에는 첫 상태가 오기 전까지 players가 비어 있다. 상태가 오면 onStateChange가 다시 그린다.
  if (!state?.players) return;
  const isHost = state.hostId === r.sessionId;
  const members: string[] = [];
  state.players.forEach((p) => members.push(`${p.id}|${p.name}|${p.isHost}|${p.connected}|${p.colorIndex}|${p.alive}|${p.carriedTotal}|${p.joinOrder}`));
  const roster = members.join(',');

  switch (state.phase) {
    case 'lobby': {
      const key = `lobby:${isHost}:${roster}`;
      if (key === drawn) return;
      drawn = key;
      stopGame();
      showLobby(state, isHost, () => r.send('start'), inviteLink(location.origin, r.roomId), leave);
      return;
    }
    case 'playing': {
      if (drawn === 'playing') return;
      drawn = 'playing';
      stopGame();
      game = startGame(r, showGame(), leave);
      return;
    }
    case 'result': {
      const key = `result:${state.result}:${state.truckTotal}:${state.target}:${roster}`;
      if (key === drawn) return;
      drawn = key;
      stopGame();
      showResult(state, () => r.send('again'));
      return;
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function onUnexpectedLeave(old: GameRoom, code: number): Promise<void> {
  if (recovering) return;
  console.warn('connection lost', code);
  // 서버는 게임 중에만 재접속 자리를 비워 둔다. 대기실·결과에서 끊기면 곧바로 첫 화면.
  if (old.state?.phase !== 'playing') {
    resetSession();
    showError(CONNECTION_LOST, () => goHome(), '첫 화면으로');
    return;
  }
  recovering = true;
  // 끊긴 방의 게임 화면은 멈춘다(마지막 화면은 남는다). 재접속하면 bind → render가 새로 시작한다.
  stopGame();
  const token = loadReconnectToken() ?? old.reconnectionToken;
  showReconnecting(CONFIG.reconnectSeconds);
  try {
    const next = await reconnectLoop<GameRoom>({
      attempt: () => reconnect(token),
      seconds: CONFIG.reconnectSeconds,
      intervalMs: RECONNECT_INTERVAL_MS,
      now: () => Date.now(),
      sleep,
      onTick: showReconnecting,
    });
    if (next) {
      bind(next);
    } else {
      resetSession();
      showError(CONNECTION_LOST, () => goHome(), '첫 화면으로');
    }
  } finally {
    hideReconnecting();
    recovering = false;
  }
}

/** E2E·수동 확인용 디버그 훅(Task 20). 개발 서버이거나 `?debug=1`일 때만 노출한다. */
if (import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1') {
  window.__bhDebug = {
    get selfId() { return room?.sessionId ?? null; },
    getState: () => {
      const state = room?.state as { toJSON?: () => unknown } | undefined;
      return state?.toJSON ? state.toJSON() : null;
    },
    getRender: () => game?.snapshot() ?? null,
    getAudio: () => game?.audioState() ?? null,
  };
}

goHome();
