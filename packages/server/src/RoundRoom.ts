import { randomInt } from 'node:crypto';
import { Room, ServerError, matchMaker } from 'colyseus';
import { CONFIG, generateRoomCode } from '@bh/shared';
import { dedupeNickname, nextHost, validateNickname } from './lobby.ts';
import { PlayerS, RoomState } from './schema.ts';
import { GAME_VERSION } from './version.ts';

export type JoinOptions = { name: string; version: string };

/** 입장 거부 코드. 클라이언트 에러의 `code`/`message`로 전달된다. */
export const JOIN_ERRORS = {
  ROOM_FULL: { code: 4001, message: 'ROOM_FULL' },
  VERSION_MISMATCH: { code: 4002, message: 'VERSION_MISMATCH' },
  IN_PROGRESS: { code: 4003, message: 'IN_PROGRESS' },
  BAD_NICKNAME: { code: 4004, message: 'BAD_NICKNAME' },
} as const;

const randomUnit = (): number => randomInt(0, 2 ** 32) / 2 ** 32;

function reject(e: { code: number; message: string }): never {
  throw new ServerError(e.code, e.message);
}

export class RoundRoom extends Room<{ state: RoomState }> {
  // 정원(4명)은 onAuth에서 검사한다. maxClients에 닿으면 Colyseus가 구분 없는 "locked"로 거절하기 때문.
  maxClients = 8;
  private joinCounter = 0;

  async onCreate(_options: Partial<JoinOptions>): Promise<void> {
    let code = generateRoomCode(randomUnit);
    while (await matchMaker.getRoomById(code)) code = generateRoomCode(randomUnit);
    this.roomId = code;
    this.setState(new RoomState());
    this.state.phase = 'lobby';

    this.onMessage('start', (client) => {
      if (this.state.phase !== 'lobby' || client.sessionId !== this.state.hostId) return;
      // Task 14가 월드 생성과 게임 루프로 교체한다. 지금은 단계만 바꾼다.
      this.state.phase = 'playing';
    });
    this.onMessage('again', () => {
      if (this.state.phase !== 'result') return;
      this.returnToLobby();
    });
  }

  onAuth(_client: any, options: Partial<JoinOptions> | undefined): boolean {
    if (options?.version !== GAME_VERSION) reject(JOIN_ERRORS.VERSION_MISMATCH);
    if (this.state.phase !== 'lobby') reject(JOIN_ERRORS.IN_PROGRESS);
    if (this.state.players.size >= CONFIG.maxPlayers) reject(JOIN_ERRORS.ROOM_FULL);
    if (validateNickname(options?.name) === null) reject(JOIN_ERRORS.BAD_NICKNAME);
    return true;
  }

  onJoin(client: any, options: JoinOptions): void {
    const taken: string[] = [];
    const usedColors = new Set<number>();
    this.state.players.forEach((p) => { taken.push(p.name); usedColors.add(p.colorIndex); });

    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex++;

    const player = new PlayerS();
    player.id = client.sessionId;
    player.name = dedupeNickname(validateNickname(options.name) ?? '', taken);
    player.colorIndex = colorIndex;
    player.joinOrder = ++this.joinCounter;
    player.connected = true;
    this.state.players.set(client.sessionId, player);
    // 첫 입장자(방을 만든 사람)가 방장.
    if (this.state.players.size === 1) this.assignHost(client.sessionId);
  }

  onLeave(client: any): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase === 'lobby') {
      this.state.players.delete(client.sessionId);
      if (client.sessionId === this.state.hostId) this.electHost();
    } else {
      // 진행 중 이탈과 재접속 유예는 Task 14가 다룬다.
      player.connected = false;
    }
  }

  private returnToLobby(): void {
    const gone: string[] = [];
    this.state.players.forEach((p, id) => { if (!p.connected) gone.push(id); });
    for (const id of gone) this.state.players.delete(id);
    this.state.phase = 'lobby';
    this.state.result = '';
    if (!this.state.players.has(this.state.hostId)) this.electHost();
  }

  private electHost(): void {
    const candidates: { id: string; joinOrder: number }[] = [];
    this.state.players.forEach((p, id) => candidates.push({ id, joinOrder: p.joinOrder }));
    this.assignHost(nextHost(candidates) ?? '');
  }

  private assignHost(id: string): void {
    this.state.hostId = id;
    this.state.players.forEach((p, key) => { p.isHost = key === id; });
  }
}
