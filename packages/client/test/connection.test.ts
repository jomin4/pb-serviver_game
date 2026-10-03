import { describe, expect, it } from 'vitest';
import { joinErrorMessage, reconnectLoop, resolveServerUrl } from '../src/net/connection.ts';

describe('joinErrorMessage', () => {
  it.each([
    [{ code: 4001 }, '방이 가득 찼습니다'],
    [{ code: 4003 }, '게임이 진행 중입니다. 끝나면 다시 시도해 주세요'],
    [{ code: 4002 }, '새 버전이 있습니다. 새로고침해 주세요'],
    [{ code: 4004 }, '닉네임은 1~10자로 입력해 주세요'],
    [new Error('room "X" not found'), '방을 찾을 수 없습니다. 코드를 확인해 주세요'],
    [{ code: 4212, message: 'room "ABC" not found' }, '방을 찾을 수 없습니다. 코드를 확인해 주세요'],
    [new TypeError('fetch failed'), '서버에 연결할 수 없습니다'],
    [undefined, '서버에 연결할 수 없습니다'],
    ['boom', '서버에 연결할 수 없습니다'],
  ])('오류 문구 %#', (e, msg) => {
    expect(joinErrorMessage(e)).toBe(msg);
  });
});

describe('resolveServerUrl', () => {
  it('환경 변수가 있으면 그대로 쓴다', () => {
    expect(resolveServerUrl('ws://localhost:2567', { protocol: 'http:', host: 'x.test' })).toBe('ws://localhost:2567');
  });
  it('환경 변수가 없으면 같은 출처: http는 ws', () => {
    expect(resolveServerUrl(undefined, { protocol: 'http:', host: 'localhost:2567' })).toBe('ws://localhost:2567');
  });
  it('환경 변수가 없으면 같은 출처: https는 wss', () => {
    expect(resolveServerUrl(undefined, { protocol: 'https:', host: 'abc.trycloudflare.com' })).toBe('wss://abc.trycloudflare.com');
  });
  it('빈 문자열 환경 변수는 없는 것으로 본다', () => {
    expect(resolveServerUrl('', { protocol: 'https:', host: 'x.test' })).toBe('wss://x.test');
  });
});

/** 가짜 시계: sleep이 시간을 앞으로 돌린다. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
}

describe('reconnectLoop', () => {
  it('성공할 때까지 2초 간격으로 재시도하고 방을 돌려준다', async () => {
    const clock = fakeClock();
    const attemptTimes: number[] = [];
    const result = await reconnectLoop<string>({
      seconds: 20, intervalMs: 2000, now: clock.now, sleep: clock.sleep, onTick: () => {},
      attempt: async () => {
        attemptTimes.push(clock.now());
        if (attemptTimes.length < 3) throw new TypeError('fetch failed');
        return 'room';
      },
    });
    expect(result).toBe('room');
    expect(attemptTimes).toEqual([0, 2000, 4000]);
  });

  it('20초가 지나면 null', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await reconnectLoop<string>({
      seconds: 20, intervalMs: 2000, now: clock.now, sleep: clock.sleep, onTick: () => {},
      attempt: async () => { attempts++; throw new TypeError('fetch failed'); },
    });
    expect(result).toBeNull();
    expect(attempts).toBe(10);
    expect(clock.now()).toBeGreaterThanOrEqual(20000);
    expect(clock.now()).toBeLessThan(21000);
  });

  it('남은 초를 매초 알린다', async () => {
    const clock = fakeClock();
    const ticks: number[] = [];
    await reconnectLoop<string>({
      seconds: 5, intervalMs: 2000, now: clock.now, sleep: clock.sleep, onTick: (n) => ticks.push(n),
      attempt: async () => { throw new TypeError('fetch failed'); },
    });
    expect(ticks).toEqual([5, 4, 3, 2, 1]);
  });

  it('방이 없다는 오류면 기다리지 않고 포기한다', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await reconnectLoop<string>({
      seconds: 20, intervalMs: 2000, now: clock.now, sleep: clock.sleep, onTick: () => {},
      attempt: async () => { attempts++; throw new Error('room "X" not found'); },
    });
    expect(result).toBeNull();
    expect(attempts).toBe(1);
  });

  it('시도가 오래 걸려도 전체 제한 시간을 넘기지 않는다', async () => {
    const clock = fakeClock();
    const result = await reconnectLoop<string>({
      seconds: 20, intervalMs: 2000, now: clock.now, sleep: clock.sleep, onTick: () => {},
      attempt: async () => { clock.advance(8000); throw new TypeError('fetch failed'); },
    });
    expect(result).toBeNull();
  });
});
