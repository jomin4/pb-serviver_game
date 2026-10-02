import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { server } from '../src/app.ts';
import type { RoundRoom } from '../src/app.ts';
import { GAME_VERSION } from '../src/version.ts';

const opts = (name: string, version: string = GAME_VERSION) => ({ name, version });
const settle = async (room: RoundRoom) => { await room.waitForNextPatch(); await new Promise(r => setTimeout(r, 50)); };
const failure = async (p: Promise<unknown>): Promise<{ code?: number; message?: string }> => {
  try { await p; } catch (e) { return e as { code?: number; message?: string }; }
  throw new Error('join should have been rejected');
};
const names = (room: RoundRoom) => [...room.state.players.values()].map(p => p.name);

describe('RoundRoom 대기실', () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => { colyseus = await boot(server); });
  afterAll(async () => { await colyseus.shutdown(); });
  afterEach(async () => { await colyseus.cleanup(); });

  const create = async (name = '방장') => {
    const room = await colyseus.createRoom('round', opts(name)) as RoundRoom;
    const host = await colyseus.connectTo(room, opts(name));
    await settle(room);
    return { room, host };
  };

  it('방을 만들면 roomId가 6자리 코드이고 만든 사람이 방장', async () => {
    const { room, host } = await create('철수');
    expect(room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.state.phase).toBe('lobby');
    expect(room.state.hostId).toBe(host.sessionId);
    const me = room.state.players.get(host.sessionId)!;
    expect(me.name).toBe('철수');
    expect(me.isHost).toBe(true);
    expect(me.joinOrder).toBe(1);
    expect(me.colorIndex).toBe(0);
    expect(me.connected).toBe(true);
  });

  it('초대 코드로 입장하면 같은 방 목록에 보인다', async () => {
    const { room, host } = await create('철수');
    const guest = await colyseus.sdk.joinById(room.roomId, opts('영희'));
    await settle(room);
    expect(room.state.players.size).toBe(2);
    const g = room.state.players.get(guest.sessionId)!;
    expect(g.name).toBe('영희');
    expect(g.isHost).toBe(false);
    expect(g.joinOrder).toBe(2);
    expect(g.colorIndex).toBe(1);
    expect(room.state.hostId).toBe(host.sessionId);
    // 클라이언트 쪽 상태에도 동기화된다
    expect(host.state.players.size).toBe(2);
    expect(guest.state.players.get(host.sessionId)?.name).toBe('철수');
  });

  it('방은 비공개: joinOrCreate·join으로 남의 방에 섞이지 않고, 코드(joinById)로만 들어간다', async () => {
    const { room } = await create('철수');
    const stranger = await colyseus.sdk.joinOrCreate('round', opts('낯선이'));
    expect(stranger.roomId).not.toBe(room.roomId);
    // 공개된 방이 없으므로 join은 실패한다
    await failure(colyseus.sdk.join('round', opts('낯선이2')));
    expect(room.state.players.size).toBe(1);
    const guest = await colyseus.sdk.joinById(room.roomId, opts('영희'));
    expect(guest.roomId).toBe(room.roomId);
  });

  it('5번째 입장은 4001 ROOM_FULL', async () => {
    const { room } = await create('a');
    for (const n of ['b', 'c', 'd']) await colyseus.sdk.joinById(room.roomId, opts(n));
    await settle(room);
    expect(room.state.players.size).toBe(4);
    const e = await failure(colyseus.sdk.joinById(room.roomId, opts('e')));
    expect(e.code).toBe(4001);
    expect(e.message).toBe('ROOM_FULL');
    expect(room.state.players.size).toBe(4);
  });

  it('진행 중 입장은 4003 IN_PROGRESS', async () => {
    const { room, host } = await create('a');
    host.send('start');
    await settle(room);
    expect(room.state.phase).toBe('playing');
    const e = await failure(colyseus.sdk.joinById(room.roomId, opts('b')));
    expect(e.code).toBe(4003);
    expect(e.message).toBe('IN_PROGRESS');
  });

  it('버전이 다르면 4002 VERSION_MISMATCH', async () => {
    const { room } = await create('a');
    const e = await failure(colyseus.sdk.joinById(room.roomId, opts('b', 'old-version')));
    expect(e.code).toBe(4002);
    expect(e.message).toBe('VERSION_MISMATCH');
    expect(room.state.players.size).toBe(1);
  });

  it('닉네임이 규칙에 어긋나면 4004 BAD_NICKNAME', async () => {
    const { room } = await create('a');
    for (const bad of ['   ', '가'.repeat(11)]) {
      const e = await failure(colyseus.sdk.joinById(room.roomId, opts(bad)));
      expect(e.code).toBe(4004);
      expect(e.message).toBe('BAD_NICKNAME');
    }
    expect(room.state.players.size).toBe(1);
  });

  it('검사 순서: 버전 > 진행 중 > 정원 > 닉네임', async () => {
    const { room, host } = await create('a');
    for (const n of ['b', 'c', 'd']) await colyseus.sdk.joinById(room.roomId, opts(n));
    await settle(room);
    expect((await failure(colyseus.sdk.joinById(room.roomId, opts('', 'old')))).code).toBe(4002);
    expect((await failure(colyseus.sdk.joinById(room.roomId, opts('')))).code).toBe(4001);
    host.send('start');
    await settle(room);
    expect((await failure(colyseus.sdk.joinById(room.roomId, opts('')))).code).toBe(4003);
  });

  it('방장이 나가면 다음 사람이 방장', async () => {
    const { room, host } = await create('a');
    const b = await colyseus.sdk.joinById(room.roomId, opts('b'));
    const c = await colyseus.sdk.joinById(room.roomId, opts('c'));
    await settle(room);
    await host.leave();
    await settle(room);
    expect(room.state.players.size).toBe(2);
    expect(room.state.hostId).toBe(b.sessionId);
    expect(room.state.players.get(b.sessionId)!.isHost).toBe(true);
    expect(room.state.players.get(c.sessionId)!.isHost).toBe(false);
  });

  it('나간 사람의 색은 다음 입장자가 쓴다(가장 낮은 빈 색)', async () => {
    const { room } = await create('a');
    const b = await colyseus.sdk.joinById(room.roomId, opts('b'));
    await colyseus.sdk.joinById(room.roomId, opts('c'));
    await settle(room);
    await b.leave();
    await settle(room);
    const d = await colyseus.sdk.joinById(room.roomId, opts('d'));
    await settle(room);
    expect(room.state.players.get(d.sessionId)!.colorIndex).toBe(1);
  });

  it('방장 아닌 사람의 start는 무시', async () => {
    const { room } = await create('a');
    const b = await colyseus.sdk.joinById(room.roomId, opts('b'));
    await settle(room);
    b.send('start');
    await settle(room);
    expect(room.state.phase).toBe('lobby');
  });

  it('같은 닉네임은 철수(2)로 표시', async () => {
    const { room } = await create('철수');
    const b = await colyseus.sdk.joinById(room.roomId, opts('철수'));
    const c = await colyseus.sdk.joinById(room.roomId, opts(' 철수 '));
    await settle(room);
    expect(names(room)).toEqual(['철수', '철수(2)', '철수(3)']);
    expect(room.state.players.get(b.sessionId)!.name).toBe('철수(2)');
    expect(room.state.players.get(c.sessionId)!.name).toBe('철수(3)');
  });

  it('again은 결과 단계에서만 대기실로 되돌린다', async () => {
    const { room, host } = await create('a');
    host.send('again');
    await settle(room);
    expect(room.state.phase).toBe('lobby');
    room.state.phase = 'result';
    room.state.result = 'success';
    const b = await colyseus.sdk.joinById(room.roomId, opts('b')).catch(() => null);
    expect(b).toBeNull(); // 결과 단계에서도 입장 불가
    host.send('again');
    await settle(room);
    expect(room.state.phase).toBe('lobby');
    expect(room.state.result).toBe('');
    expect(room.state.players.size).toBe(1);
  });
});
