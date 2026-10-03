import { randomInt } from 'node:crypto';
import { Room, ServerError, matchMaker } from 'colyseus';
import { CONFIG, capInputs, createWorld, dropAll, generateRoomCode, sanitizeBatch, step } from '@bh/shared';
import type { GameEvent, PlayerInput, World } from '@bh/shared';
import { dedupeNickname, nextHost, validateNickname } from './lobby.ts';
import { PlayerS, RoomState, syncSchema } from './schema.ts';
import { GAME_VERSION } from './version.ts';

export type JoinOptions = { name: string; version: string };

/**
 * 서버가 `defineRoom(RoundRoom, defaults)`로만 정하는 옵션(테스트용). 클라이언트의 생성 옵션으로는 바꿀 수 없다.
 * Colyseus는 onCreate에 `merge(clientOptions, defaults)`를 넘기는데, 서버가 기본값을 정하지 않은 키는
 * 클라이언트 값이 그대로 통과한다. 그래서 onCreate 인자는 쓰지 않고 등록된 핸들러의 기본값만 읽는다.
 */
export type RoundRoomOptions = { reconnectSeconds?: number; stepFn?: typeof step };

const MAP_ID = 'parking-lot';
export const ROUND_ERROR_MESSAGE = '오류로 라운드가 종료되었습니다';

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

  /** 진행 중 라운드의 월드(서버 소유). 대기실·결과 단계 직후에는 null. 테스트가 들여다본다. */
  world: World | null = null;
  /** 재접속 유예(초). 서버 정의의 기본값 또는 CONFIG. */
  reconnectSeconds: number = CONFIG.reconnectSeconds;
  stepFn: typeof step = step;

  private queues: Record<string, PlayerInput[]> = {};
  /** 다음 틱에 보낼 서버 발생 이벤트(연결 끊김 사망). step은 틱마다 world.events를 비우므로 따로 둔다. */
  private pendingEvents: GameEvent[] = [];
  /** 클라이언트별 메시지 빈도 창. 창은 첫 메시지 시각에서 시작해 1초 뒤 새로 연다. */
  private rate = new Map<string, { start: number; count: number }>();

  async onCreate(_clientOptions: Partial<JoinOptions> & RoundRoomOptions): Promise<void> {
    const defaults: RoundRoomOptions = matchMaker.getHandler(this.roomName).options ?? {};
    if (typeof defaults.reconnectSeconds === 'number') this.reconnectSeconds = defaults.reconnectSeconds;
    if (typeof defaults.stepFn === 'function') this.stepFn = defaults.stepFn;

    let code = generateRoomCode(randomUnit);
    while (await matchMaker.getRoomById(code)) code = generateRoomCode(randomUnit);
    this.roomId = code;
    // 비공개 방: joinOrCreate/join 매칭에 잡히지 않아 낯선 사람이 섞이지 않는다. 코드(joinById)로만 들어온다.
    await this.setPrivate(true);
    this.setState(new RoomState());
    this.state.phase = 'lobby';
    console.info({ event: 'roomCreated', roomId: this.roomId });

    this.handle('start', (client) => {
      if (this.state.phase !== 'lobby' || client.sessionId !== this.state.hostId) return;
      this.startRound();
    });
    this.handle('input', (client, message) => {
      const world = this.world;
      if (this.state.phase !== 'playing' || !world || !world.players[client.sessionId]) return;
      const inputs = sanitizeBatch(message);
      if (inputs.length === 0) return;
      const queue = (this.queues[client.sessionId] ?? []).concat(inputs);
      // 오래된 것부터 버리고 최근 maxInputsPerBatch개만 남긴다. 버려지는 입력의 엣지는 남는 입력에 접는다.
      this.queues[client.sessionId] = capInputs(queue, CONFIG.net.maxInputsPerBatch);
    });
    this.handle('again', () => {
      if (this.state.phase !== 'result') return;
      this.returnToLobby();
    });
  }

  /** 메시지 핸들러 등록. 모든 메시지를 클라이언트별 초당 maxMessagesPerSecond개로 제한한다(초과분은 버림). */
  private handle(type: string, fn: (client: any, message: unknown) => void): void {
    this.onMessage(type, (client: any, message: unknown) => {
      if (!this.allowMessage(client.sessionId)) return;
      fn(client, message);
    });
  }

  private allowMessage(sessionId: string): boolean {
    const now = Date.now();
    let w = this.rate.get(sessionId);
    if (!w || now - w.start >= 1000) { w = { start: now, count: 0 }; this.rate.set(sessionId, w); }
    w.count++;
    return w.count <= CONFIG.net.maxMessagesPerSecond;
  }

  private startRound(): void {
    const players: { id: string; name: string }[] = [];
    const ordered: PlayerS[] = [];
    this.state.players.forEach((p) => ordered.push(p));
    ordered.sort((a, b) => a.joinOrder - b.joinOrder);
    for (const p of ordered) players.push({ id: p.id, name: p.name });

    const seed = randomInt(0, 2 ** 31 - 1);
    try {
      this.world = createWorld({ mapId: MAP_ID, seed, players });
    } catch (err) {
      console.error({ roomId: this.roomId, tick: 0, seed, err });
      this.broadcast('roundError', { message: ROUND_ERROR_MESSAGE });
      return;
    }
    this.queues = {};
    this.pendingEvents = [];
    this.state.phase = 'playing';
    this.state.result = '';
    syncSchema(this.world, this.state);
    this.setPatchRate(CONFIG.patchMs);
    this.setTimestep((deltaMs) => this.tick(deltaMs), CONFIG.tickMs);
    console.info({ event: 'roundStarted', roomId: this.roomId, seed, players: players.map((p) => p.name) });
  }

  /** step이 아직 쓰지 않은 입력(seq > lastSeq). step은 실제 흐른 시간만큼만 입력을 쓰므로 나머지는 다음 틱으로 넘긴다. */
  private unusedInputs(world: World): Record<string, PlayerInput[]> {
    const out: Record<string, PlayerInput[]> = {};
    for (const [id, queue] of Object.entries(this.queues)) {
      const p = world.players[id];
      if (!p) continue;
      const rest = queue.filter((i) => i.seq > p.lastSeq);
      if (rest.length > 0) out[id] = rest;
    }
    return out;
  }

  /** 한 틱. 오류는 이 방의 라운드만 끝낸다. */
  private tick(deltaMs: number): void {
    const world = this.world;
    if (!world || this.state.phase !== 'playing') return;
    try {
      this.world = this.stepFn(world, this.queues, deltaMs / 1000);
      this.queues = this.unusedInputs(this.world);
      syncSchema(this.world, this.state);
      const events = this.pendingEvents.concat(this.world.events);
      this.pendingEvents = [];
      for (const e of events) this.broadcast('event', e);
      if (this.world.round.phase !== 'playing') this.finishRound(this.world);
    } catch (err) {
      console.error({ roomId: this.roomId, tick: world.tick, seed: world.seed, err });
      try {
        this.abortRound();
      } catch (abortErr) {
        // 마지막 방어선: 인터벌 밖으로 아무것도 새어 나가지 않게 한다.
        console.error({ roomId: this.roomId, tick: world.tick, seed: world.seed, err: abortErr });
      }
    }
  }

  private finishRound(world: World): void {
    this.state.phase = 'result';
    this.state.result = world.round.phase;
    this.stopLoop();
    console.info({
      event: 'roundEnded', roomId: this.roomId, seed: world.seed,
      players: Object.values(world.players).map((p) => p.name), result: world.round.phase,
    });
  }

  private stopLoop(): void {
    this.setTimestep();
  }

  /** 오류로 라운드를 버리고 같은 멤버로 대기실에 돌아간다. */
  private abortRound(): void {
    this.stopLoop();
    try { this.broadcast('roundError', { message: ROUND_ERROR_MESSAGE }); } catch (err) { console.error({ roomId: this.roomId, err }); }
    this.returnToLobby();
  }

  /** 접속이 끊긴 플레이어를 사망 처리한다(생존자만, 한 번). 사망 이벤트는 다음 틱에 보낸다. */
  private killDisconnected(id: string): void {
    const world = this.world;
    if (!world || this.state.phase !== 'playing' || world.round.phase !== 'playing') return;
    const p = world.players[id];
    if (!p) return;
    p.connected = false;
    if (!p.alive) return;
    p.alive = false;
    p.flashlightOn = false;
    dropAll(world, id);
    this.pendingEvents.push({ type: 'death', playerId: id, cause: 'disconnect' });
  }

  private setConnected(id: string, connected: boolean): void {
    const s = this.state.players.get(id);
    if (s) s.connected = connected;
    const p = this.world?.players[id];
    if (p) p.connected = connected;
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

  /** 끊김. 진행 중이면 재접속을 기다린다. 그 밖의 단계는 기다리지 않는다(이어서 onLeave가 불린다). */
  async onDrop(client: any): Promise<void> {
    const id: string = client.sessionId;
    // 현재 멤버가 아니면(이미 빠진 사람) 재접속 자리를 주지 않는다.
    if (this.state.phase !== 'playing' || !this.world?.players[id] || !this.state.players.has(id)) return;
    this.setConnected(id, false);
    try {
      await this.allowReconnection(client, this.reconnectSeconds);
    } catch {
      this.killDisconnected(id); // 유예 초과. 이어서 onLeave가 불린다.
      return;
    }
    // 유예 안에 돌아오면 단계와 상관없이 복귀한다(기다리는 사이 라운드가 끝났어도 결과 화면에 남는다).
    if (this.state.players.has(id)) this.setConnected(id, true);
    else client.leave(); // 기다리는 사이 오류로 대기실에 돌아가며 멤버에서 빠졌다.
  }

  onLeave(client: any): void {
    const id: string = client.sessionId;
    this.rate.delete(id);
    delete this.queues[id];
    const player = this.state.players.get(id);
    if (!player) return;
    if (this.state.phase === 'playing') {
      // 결과 화면에 나열할 수 있게 항목은 남기고 접속 표시만 끈다.
      this.killDisconnected(id);
      player.connected = false;
    } else {
      this.state.players.delete(id);
    }
    if (id === this.state.hostId) this.electHost();
  }

  onDispose(): void {
    console.info({ event: 'roomDisposed', roomId: this.roomId, seed: this.world?.seed ?? this.state.seed });
  }

  /** 대기실로 돌아간다. 접속이 끊긴 멤버는 뺀다. */
  private returnToLobby(): void {
    const gone: string[] = [];
    this.state.players.forEach((p, id) => { if (!p.connected) gone.push(id); });
    for (const id of gone) this.state.players.delete(id);
    this.world = null;
    this.queues = {};
    this.pendingEvents = [];
    this.state.items.clear();
    this.state.monsters.clear();
    this.state.lights.clear();
    this.state.clock = 0;
    this.state.target = 0;
    this.state.truckTotal = 0;
    this.state.phase = 'lobby';
    this.state.result = '';
    if (!this.state.players.has(this.state.hostId)) this.electHost();
  }

  private electHost(): void {
    const candidates: { id: string; joinOrder: number }[] = [];
    this.state.players.forEach((p, id) => { if (p.connected) candidates.push({ id, joinOrder: p.joinOrder }); });
    this.assignHost(nextHost(candidates) ?? '');
  }

  private assignHost(id: string): void {
    this.state.hostId = id;
    this.state.players.forEach((p, key) => { p.isHost = key === id; });
  }
}
