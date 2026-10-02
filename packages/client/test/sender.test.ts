import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_INPUT } from '@bh/shared';
import type { PlayerInput } from '@bh/shared';
import { createSender } from '../src/input/sender.ts';

const inp = (seq: number, extra: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT(seq), ...extra });

describe('sender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sender는 33ms마다 묶어서 보낸다', () => {
    const send = vi.fn();
    const s = createSender(send);
    s.start();
    s.push(inp(1)); s.push(inp(2)); s.push(inp(3));
    vi.advanceTimersByTime(32);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as PlayerInput[]).map((i) => i.seq)).toEqual([1, 2, 3]);
    s.stop();
  });
  it('보낸 뒤에는 비운다: 다음 주기에는 새로 쌓인 것만', () => {
    const send = vi.fn();
    const s = createSender(send);
    s.start();
    s.push(inp(1));
    vi.advanceTimersByTime(33);
    s.push(inp(2));
    vi.advanceTimersByTime(33);
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1]![0] as PlayerInput[]).map((i) => i.seq)).toEqual([2]);
  });
  it('빈 배치는 보내지 않는다', () => {
    const send = vi.fn();
    const s = createSender(send);
    s.start();
    vi.advanceTimersByTime(500);
    s.flush();
    expect(send).not.toHaveBeenCalled();
    s.stop();
  });
  it('flush는 즉시 보낸다', () => {
    const send = vi.fn();
    const s = createSender(send);
    s.push(inp(1)); s.push(inp(2));
    s.flush();
    expect(send).toHaveBeenCalledTimes(1);
    s.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('stop하면 더 이상 보내지 않고, start를 두 번 불러도 타이머는 하나', () => {
    const send = vi.fn();
    const s = createSender(send);
    s.start(); s.start();
    s.push(inp(1));
    vi.advanceTimersByTime(33);
    expect(send).toHaveBeenCalledTimes(1);
    s.stop();
    s.push(inp(2));
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('주기를 바꿀 수 있다', () => {
    const send = vi.fn();
    const s = createSender(send, 100);
    s.start(); s.push(inp(1));
    vi.advanceTimersByTime(99);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    s.stop();
  });
  it('서버 한도(10개)를 넘으면 엣지가 있는 입력과 최근 입력을 남기고 seq 순서로 보낸다', () => {
    const send = vi.fn();
    const s = createSender(send);
    for (let seq = 1; seq <= 14; seq++) {
      s.push(seq === 2 ? inp(seq, { drop: true }) : seq === 5 ? inp(seq, { selectSlot: 1 }) : inp(seq));
    }
    s.flush();
    const seqs = (send.mock.calls[0]![0] as PlayerInput[]).map((i) => i.seq);
    expect(seqs).toHaveLength(10);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toContain(2);
    expect(seqs).toContain(5);
    expect(seqs.slice(-8)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });
  it.each<[string, Partial<PlayerInput>]>([
    ['toggleFlashlight', { toggleFlashlight: true }],
    ['drop', { drop: true }],
    ['selectSlot', { selectSlot: 0 }],
    ['ping', { ping: { x: 1, y: 1 } }],
    ['chat', { chat: 0 }],
    ['flicker', { flicker: true }],
  ])('%s 엣지는 한도 초과 시에도 버려지지 않는다', (_n, extra) => {
    const send = vi.fn();
    const s = createSender(send);
    s.push(inp(1, extra));
    for (let seq = 2; seq <= 20; seq++) s.push(inp(seq));
    s.flush();
    const seqs = (send.mock.calls[0]![0] as PlayerInput[]).map((i) => i.seq);
    expect(seqs).toHaveLength(10);
    expect(seqs[0]).toBe(1);
  });
  it('엣지 입력이 한도보다 많으면 가장 최근 엣지 10개를 남긴다', () => {
    const send = vi.fn();
    const s = createSender(send);
    for (let seq = 1; seq <= 12; seq++) s.push(inp(seq, { drop: true }));
    s.flush();
    expect((send.mock.calls[0]![0] as PlayerInput[]).map((i) => i.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('주입한 타이머 함수를 쓴다', () => {
    let cb: (() => void) | undefined;
    const clear = vi.fn();
    const send = vi.fn();
    const s = createSender(send, 33, { setInterval: (f) => { cb = f; return 7; }, clearInterval: clear });
    s.start(); s.push(inp(1));
    cb?.();
    expect(send).toHaveBeenCalledTimes(1);
    s.stop();
    expect(clear).toHaveBeenCalledWith(7);
  });
});
