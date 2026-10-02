import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import { defineRoom, defineServer } from 'colyseus';
import { CONFIG, EMPTY_INPUT, step } from '@bh/shared';
import type { GameEvent, PlayerInput, World } from '@bh/shared';
import { RoundRoom } from '../src/RoundRoom.ts';
import { GAME_VERSION } from '../src/version.ts';

type Conn = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;

const opts = (name: string, extra: Record<string, unknown> = {}) => ({ name, version: GAME_VERSION, ...extra });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, timeoutMs = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await sleep(10);
  }
};
const input = (seq: number, patch: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT(seq), ...patch });
/** 소켓만 강제로 끊는다(재접속 유예가 시작된다). */
const drop = (c: Conn): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (c as any).connection;
  conn.transport?.ws?.close?.() ?? conn.close?.();
};
const collect = (c: { onMessage(type: string, cb: (m: any) => void): unknown }, type: string): unknown[] => {
  const got: unknown[] = [];
  c.onMessage(type, (m: unknown) => { got.push(m); });
  return got;
};

// flaky: tick 3에서 한 번 던진다. recording: 틱마다 step에 넘어온 큐 길이를 기록한다. plain: 기본 옵션 없음.
let throwAtTick = 3;
const flaky = (w: World, inputs: Record<string, PlayerInput[]>, dt: number): World => {
  if (w.tick >= throwAtTick) { throwAtTick = Infinity; throw new Error('boom'); }
  return step(w, inputs, dt);
};
const queueSizes: number[] = [];
const recording = (w: World, inputs: Record<string, PlayerInput[]>, dt: number): World => {
  for (const q of Object.values(inputs)) queueSizes.push(q.length);
  return step(w, inputs, dt);
};
const gameServer = defineServer({
  rooms: {
    round: defineRoom(RoundRoom, { reconnectSeconds: 1 }),
    flaky: defineRoom(RoundRoom, { reconnectSeconds: 1, stepFn: flaky }),
    recording: defineRoom(RoundRoom, { stepFn: recording }),
    plain: defineRoom(RoundRoom),
  },
});

// room.lobby.test.ts가 기본 포트(2568)를 쓰고 파일이 병렬로 돌므로 다른 포트를 쓴다.
const GAME_TEST_PORT = 2569;
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  // boot()는 Server 인스턴스를 받으면 포트 인자를 무시하고 2568에 묶으므로 직접 listen한다.
  await gameServer.listen(GAME_TEST_PORT);
  colyseus = new ColyseusTestServer(gameServer);
});
afterAll(async () => { await colyseus.shutdown(); });
afterEach(async () => { await colyseus.cleanup(); });

describe('RoundRoom 게임 루프', () => {
  /** 방장 + 손님 n명이 들어간 대기실. */
  const lobby = async (guests = 1) => {
    const room = await colyseus.createRoom('round', opts('방장')) as RoundRoom;
    const host = await colyseus.connectTo(room, opts('방장'));
    const others: Conn[] = [];
    for (let i = 0; i < guests; i++) others.push(await colyseus.sdk.joinById(room.roomId, opts(`손님${i + 1}`)));
    await waitFor(() => room.state.players.size === guests + 1);
    // 모든 클라이언트가 'event'를 받는다(등록하지 않으면 SDK가 경고한다).
    const events: Record<string, GameEvent[]> = {};
    for (const c of [host, ...others]) events[c.sessionId] = collect(c, 'event') as GameEvent[];
    return { room, host, others, events };
  };
  const started = async (guests = 1) => {
    const l = await lobby(guests);
    l.host.send('start');
    await waitFor(() => l.room.state.phase === 'playing' && l.room.world !== null);
    return l;
  };
  const worldOf = (room: RoundRoom): World => room.world!;

  it('시작하면 playing이 되고 시계가 흐른다', async () => {
    const { room, host, others } = await started(1);
    const w = worldOf(room);
    expect(room.state.mapId).toBe('parking-lot');
    expect(Number.isInteger(room.state.seed)).toBe(true);
    expect(w.seed).toBe(room.state.seed);
    // 월드 플레이어 id는 sessionId, 이름은 대기실 이름
    expect(Object.keys(w.players).sort()).toEqual([host.sessionId, others[0]!.sessionId].sort());
    expect(w.players[host.sessionId]!.name).toBe('방장');
    expect(w.players[others[0]!.sessionId]!.name).toBe('손님1');

    const tick0 = worldOf(room).tick;
    await waitFor(() => worldOf(room).tick >= tick0 + 5);
    expect(room.state.clock).toBeGreaterThan(0);
    expect(room.state.phase).toBe('playing');
    expect(room.state.items.size).toBeGreaterThan(0);
    // 시작 후에도 대기실에서 정한 값이 유지된다
    expect(room.state.players.get(host.sessionId)!.isHost).toBe(true);
  });

  it('input 메시지로 캐릭터가 움직이고 lastSeq가 갱신된다', async () => {
    const { room, host } = await started(0);
    const me = () => room.state.players.get(host.sessionId)!;
    const x0 = me().x;
    const y0 = me().y;
    for (let seq = 1; seq <= 5; seq++) {
      host.send('input', [input(seq, { move: { x: 1, y: 0 }, aim: 0.5 })]);
      await sleep(40);
    }
    await waitFor(() => me().lastSeq === 5);
    expect(Math.hypot(me().x - x0, me().y - y0)).toBeGreaterThan(0.05);
    expect(me().aim).toBeCloseTo(0.5);
    await waitFor(() => host.state.players.get(host.sessionId)?.lastSeq === 5); // 클라이언트 쪽 상태에도 전달된다
  });

  it('잘못된 형식의 input을 보내도 서버가 계속 동작한다', async () => {
    const { room, host, others } = await started(1);
    const other = others[0]!;
    for (const junk of ['garbage', null, 42, { seq: 'x' }, [null, 7, { seq: -1 }], [{ seq: 1, move: { x: 'a' } }].concat(undefined as never)]) {
      other.send('input', junk);
    }
    host.send('input', [input(1, { move: { x: 1, y: 0 } })]);
    await waitFor(() => room.state.players.get(host.sessionId)!.lastSeq === 1);
    const tick = worldOf(room).tick;
    await waitFor(() => worldOf(room).tick > tick + 2);
    expect(room.state.phase).toBe('playing');
    expect(room.state.players.get(other.sessionId)!.connected).toBe(true);
  });

  it('1초에 61번째 메시지부터는 버린다', async () => {
    const { room, others } = await started(1);
    const guest = others[0]!;
    for (let seq = 1; seq <= 61; seq++) guest.send('input', [input(seq)]);
    const lastSeq = () => room.state.players.get(guest.sessionId)!.lastSeq;
    await waitFor(() => lastSeq() >= 60);
    await sleep(200);
    expect(lastSeq()).toBe(60);
  });

  it('20초(옵션) 안에 재접속하면 같은 캐릭터로 복귀', async () => {
    const { room, others } = await started(1);
    const guest = others[0]!;
    const id = guest.sessionId;
    const token = guest.reconnectionToken;
    drop(guest);
    await waitFor(() => room.state.players.get(id)!.connected === false);
    expect(worldOf(room).players[id]!.connected).toBe(false);
    expect(worldOf(room).players[id]!.alive).toBe(true);

    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(id);
    await waitFor(() => room.state.players.get(id)!.connected === true);
    expect(room.state.players.get(id)!.alive).toBe(true);
    expect(worldOf(room).players[id]!.connected).toBe(true);
    expect(room.state.phase).toBe('playing');
    // 유예가 끝날 시간까지 기다려도 죽지 않는다
    await sleep(1300);
    expect(worldOf(room).players[id]!.alive).toBe(true);
    // 되돌아온 연결로 입력도 계속 먹는다
    back.send('input', [input(1, { move: { x: 1, y: 0 } })]);
    await waitFor(() => room.state.players.get(id)!.lastSeq === 1);
  });

  it('끊긴 사이 라운드가 끝나도 유예 안에 재접속하면 결과 화면에 남고 again에 참여한다', async () => {
    const { room, host, others } = await started(1);
    const guest = others[0]!;
    const id = guest.sessionId;
    const token = guest.reconnectionToken;
    drop(guest);
    await waitFor(() => room.state.players.get(id)!.connected === false);
    worldOf(room).round.clock = CONFIG.roundEndClock;
    await waitFor(() => room.state.phase === 'result');
    expect(room.state.players.has(id)).toBe(true);

    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(id);
    await waitFor(() => room.state.players.get(id)!.connected === true);
    expect(room.state.players.has(id)).toBe(true);
    await sleep(1300); // 유예가 지나도 쫓겨나지 않는다
    expect(room.state.players.get(id)!.connected).toBe(true);
    expect(room.state.phase).toBe('result');

    host.send('again');
    await waitFor(() => room.state.phase === 'lobby');
    expect([...room.state.players.keys()].sort()).toEqual([host.sessionId, id].sort());
  });

  it('재접속하지 않으면 유예 후 사망 처리(소지품 낙하, 사망 이벤트)', async () => {
    const { room, host, others, events } = await started(1);
    const guest = others[0]!;
    const id = guest.sessionId;
    const deaths = events[host.sessionId]!;
    const itemId = Object.keys(worldOf(room).items)[0]!;
    giveItem(room, id, itemId);

    drop(guest);
    await waitFor(() => room.state.players.get(id)!.connected === false);
    expect(worldOf(room).players[id]!.alive).toBe(true); // 유예 중에는 제자리에 남는다
    await waitFor(() => worldOf(room).players[id]!.alive === false, 4000);

    const p = worldOf(room).players[id]!;
    expect(p.flashlightOn).toBe(false);
    expect(p.inventory).toEqual([]);
    expect(worldOf(room).items[itemId]!.carriedBy).toBeNull();
    await waitFor(() => (deaths as GameEvent[]).some((e) => e.type === 'death' && e.playerId === id && e.cause === 'disconnect'));
    await waitFor(() => room.state.players.get(id)!.alive === false);
    expect(room.state.players.get(id)!.connected).toBe(false);
    expect(room.state.phase).toBe('playing');
  });

  it('진행 중 자발적으로 나가면 즉시 사망하고 소지품이 떨어진다', async () => {
    const { room, host, others, events: all } = await started(1);
    const guest = others[0]!;
    const id = guest.sessionId;
    const events = all[host.sessionId]!;
    const itemId = Object.keys(worldOf(room).items)[0]!;
    giveItem(room, id, itemId);

    await guest.leave(); // 동의한 퇴장: 재접속 유예 없음
    await waitFor(() => worldOf(room).players[id]!.alive === false, 500);
    expect(worldOf(room).items[itemId]!.carriedBy).toBeNull();
    expect(worldOf(room).players[id]!.inventory).toEqual([]);
    await waitFor(() => (events as GameEvent[]).some((e) => e.type === 'death' && e.playerId === id && e.cause === 'disconnect'));
    // 결과 화면에 나열할 수 있도록 항목은 남기고 접속 표시만 끈다
    expect(room.state.players.has(id)).toBe(true);
    expect(room.state.players.get(id)!.connected).toBe(false);
  });

  it('방장이 진행 중 나가면 남은 접속자가 방장이 된다', async () => {
    const { room, host, others } = await started(1);
    await host.leave();
    await waitFor(() => room.state.hostId === others[0]!.sessionId);
    expect(room.state.players.get(others[0]!.sessionId)!.isHost).toBe(true);
    expect(room.state.players.get(host.sessionId)!.isHost).toBe(false);
    expect(room.state.phase).toBe('playing');
  });

  it('모두 죽으면 result로 바뀌고 시뮬레이션이 멈춘다', async () => {
    const { room, host, events: all } = await started(1);
    const events = all[host.sessionId]!;
    worldOf(room).round.clock = CONFIG.roundEndClock; // 다음 틱에 시간 종료로 끝난다
    await waitFor(() => room.state.phase === 'result');
    expect(room.state.result).toBe('fail');
    await waitFor(() => (events as GameEvent[]).some((e) => e.type === 'roundEnd'));
    const tick = worldOf(room).tick;
    await sleep(200);
    expect(worldOf(room).tick).toBe(tick);
  });

  it('again이면 같은 멤버로 대기실', async () => {
    const { room, host, others } = await started(2);
    worldOf(room).round.clock = CONFIG.roundEndClock;
    await waitFor(() => room.state.phase === 'result');
    host.send('again');
    await waitFor(() => room.state.phase === 'lobby');
    expect(room.world).toBeNull();
    expect(room.state.result).toBe('');
    expect([...room.state.players.keys()].sort()).toEqual([host.sessionId, ...others.map((o) => o.sessionId)].sort());
    expect(room.state.hostId).toBe(host.sessionId);
    expect(room.state.items.size).toBe(0);
    // 다시 시작할 수 있다
    host.send('start');
    await waitFor(() => room.state.phase === 'playing' && room.world !== null);
    expect(room.world!.round.phase).toBe('playing');
  });

  it('진행 중 입장하지 않은 클라이언트의 입력은 무시된다', async () => {
    const { room, host } = await lobby(0);
    host.send('input', [input(1, { move: { x: 1, y: 0 } })]); // 대기실에서는 무시
    await sleep(100);
    expect(room.world).toBeNull();
    expect(room.state.phase).toBe('lobby');
  });
});

/** 월드를 직접 만져 소지품을 쥐여 준다(서버 자신의 복사본이다). */
function giveItem(room: RoundRoom, playerId: string, itemId: string): void {
  const w = room.world!;
  w.items[itemId]!.carriedBy = playerId;
  w.players[playerId]!.inventory.push(itemId);
}

describe('RoundRoom 오류 격리', () => {
  it('규칙 실행 중 예외가 나면 roundError를 보내고 대기실로 돌아간다', async () => {
    throwAtTick = 3;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const room = await colyseus.createRoom('flaky', opts('방장')) as RoundRoom;
      const host = await colyseus.connectTo(room, opts('방장'));
      const guest = await colyseus.sdk.joinById(room.roomId, opts('손님'));
      await waitFor(() => room.state.players.size === 2);
      collect(host, 'event');
      const errors = collect(host, 'roundError');
      host.send('start');
      await waitFor(() => errors.length > 0);

      expect(errors[0]).toEqual({ message: '오류로 라운드가 종료되었습니다' });
      await waitFor(() => room.state.phase === 'lobby');
      expect(room.world).toBeNull();
      expect(room.state.players.size).toBe(2);
      expect(room.state.hostId).toBe(host.sessionId);
      expect(guest.sessionId).toBeTruthy();
      const call = err.mock.calls.find((c) => (c[0] as { err?: unknown })?.err instanceof Error);
      expect(call).toBeDefined();
      const logged = call![0] as { roomId: string; tick: number; seed: number; err: Error };
      expect(logged.roomId).toBe(room.roomId);
      expect(logged.tick).toBe(3);
      expect(Number.isInteger(logged.seed)).toBe(true);
      expect(logged.err.message).toBe('boom');

      // 시뮬레이션이 멈췄고, 같은 방에서 새 라운드를 시작할 수 있다
      await sleep(150);
      host.send('start');
      await waitFor(() => room.state.phase === 'playing' && room.world !== null);
      await waitFor(() => room.world!.tick >= 3);
      expect(room.state.phase).toBe('playing');
    } finally {
      err.mockRestore();
    }
  });

  it('한 방의 오류는 다른 방에 영향을 주지 않는다', async () => {
    throwAtTick = 3;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const a = await colyseus.createRoom('flaky', opts('A')) as RoundRoom;
      const ha = await colyseus.connectTo(a, opts('A'));
      await waitFor(() => a.state.players.size === 1);
      collect(ha, 'event'); collect(ha, 'roundError');
      ha.send('start');
      await waitFor(() => err.mock.calls.length > 0);
      // 이제 flaky는 더 던지지 않는다. 다른 방은 정상적으로 계속 돈다.
      const b = await colyseus.createRoom('flaky', opts('B')) as RoundRoom;
      const hb = await colyseus.connectTo(b, opts('B'));
      await waitFor(() => b.state.players.size === 1);
      collect(hb, 'event');
      hb.send('start');
      await waitFor(() => b.world !== null && b.world.tick >= 5);
      expect(b.state.phase).toBe('playing');
    } finally {
      err.mockRestore();
    }
  });
});

describe('RoundRoom 입력 큐', () => {
  it('틱마다 플레이어당 최근 10개까지만 step에 넘기고, 넘긴 뒤 큐를 비운다', async () => {
    const room = await colyseus.createRoom('recording', opts('방장')) as RoundRoom;
    const host = await colyseus.connectTo(room, opts('방장'));
    await waitFor(() => room.state.players.size === 1);
    collect(host, 'event');
    host.send('start');
    await waitFor(() => room.world !== null && room.world.tick >= 2);
    queueSizes.length = 0;
    // 메시지 하나가 10개씩, 모두 6통(60개). 한 틱에 몰리면 10개만 남아야 한다.
    for (let m = 0; m < 6; m++) host.send('input', Array.from({ length: 10 }, (_, i) => input(m * 10 + i + 1)));
    await waitFor(() => room.state.players.get(host.sessionId)!.lastSeq === 60);
    expect(Math.max(...queueSizes)).toBeLessThanOrEqual(CONFIG.net.maxInputsPerBatch);
    // 입력이 없는 틱에는 빈 큐가 넘어간다(큐가 비워졌다)
    const tick = room.world!.tick;
    queueSizes.length = 0;
    await waitFor(() => room.world!.tick >= tick + 3);
    expect(queueSizes.every((n) => n === 0)).toBe(true);
  });
});

describe('RoundRoom 생성 옵션', () => {
  it('클라이언트가 보낸 reconnectSeconds는 무시한다(서버 기본값 사용)', async () => {
    const room = await colyseus.createRoom('plain', opts('방장', { reconnectSeconds: 0.001 })) as RoundRoom;
    expect(room.reconnectSeconds).toBe(CONFIG.reconnectSeconds);
    expect(room.stepFn).toBe(step);
  });

  it('defineRoom 기본값이 클라이언트 값보다 우선한다', async () => {
    const room = await colyseus.createRoom('round', opts('방장', { reconnectSeconds: 99, stepFn: 'nope' })) as RoundRoom;
    expect(room.reconnectSeconds).toBe(1);
    expect(room.stepFn).toBe(step);
  });
});
