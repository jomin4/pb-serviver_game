import { describe, expect, it } from 'vitest';
import { angleTo, CONFIG } from '@bh/shared';
import {
  createInputState, onBlur, onKeyDown, onKeyUp, onMouseDown, onMouseMove, onWheel, sampleInput,
} from '../src/input/keyboard.ts';

describe('이동', () => {
  it('한글 입력 모드에서도 code 기준으로 이동한다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyW');
    expect(sampleInput(s, 1).move).toEqual({ x: 0, y: -1 });
  });
  it('WASD 네 방향 (y는 아래가 +)', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyS');
    expect(sampleInput(s, 1).move).toEqual({ x: 0, y: 1 });
    onKeyUp(s, 'KeyS'); onKeyDown(s, 'KeyA');
    expect(sampleInput(s, 2).move).toEqual({ x: -1, y: 0 });
    onKeyUp(s, 'KeyA'); onKeyDown(s, 'KeyD');
    expect(sampleInput(s, 3).move).toEqual({ x: 1, y: 0 });
  });
  it('대각선 이동은 길이 1', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyW'); onKeyDown(s, 'KeyD');
    const m = sampleInput(s, 1).move;
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(1);
    expect(m.x).toBeGreaterThan(0);
    expect(m.y).toBeLessThan(0);
  });
  it('반대 방향 키를 같이 누르면 상쇄된다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyA'); onKeyDown(s, 'KeyD');
    expect(sampleInput(s, 1).move).toEqual({ x: 0, y: 0 });
  });
  it('키를 떼면 멈춘다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyW'); onKeyUp(s, 'KeyW');
    expect(sampleInput(s, 1).move).toEqual({ x: 0, y: 0 });
  });
  it('왼쪽/오른쪽 Shift 모두 뛰기', () => {
    const s = createInputState();
    onKeyDown(s, 'ShiftRight');
    expect(sampleInput(s, 1).run).toBe(true);
    onKeyUp(s, 'ShiftRight'); onKeyDown(s, 'ShiftLeft');
    expect(sampleInput(s, 2).run).toBe(true);
    onKeyUp(s, 'ShiftLeft');
    expect(sampleInput(s, 3).run).toBe(false);
  });
  it('seq를 그대로 담는다', () => {
    expect(sampleInput(createInputState(), 42).seq).toBe(42);
  });
});

describe('blur', () => {
  it('blur 시 눌린 키가 모두 해제된다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyD'); onKeyDown(s, 'ShiftLeft'); onKeyDown(s, 'KeyE');
    onBlur(s);
    const i = sampleInput(s, 1);
    expect(i.move).toEqual({ x: 0, y: 0 });
    expect(i.run).toBe(false);
    expect(i.interact).toBe(false);
  });
  it('blur 뒤 keyup이 없어도 T 상태가 풀려 1~3은 칸 선택이 된다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyT'); onBlur(s);
    onKeyDown(s, 'Digit2');
    const i = sampleInput(s, 1);
    expect(i.chat).toBeNull();
    expect(i.selectSlot).toBe(1);
  });
  it('blur 뒤 같은 키를 다시 누르면 새 입력으로 인식한다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyF'); sampleInput(s, 1); onBlur(s);
    onKeyDown(s, 'KeyF');
    expect(sampleInput(s, 2).toggleFlashlight).toBe(true);
  });
});

describe('조준', () => {
  it('마우스 월드 좌표와 플레이어 위치로 aim을 정한다', () => {
    const s = createInputState();
    onMouseMove(s, { x: 5, y: 3 }, { x: 5, y: 1 });
    expect(sampleInput(s, 1).aim).toBeCloseTo(Math.PI / 2);
    onMouseMove(s, { x: 0, y: 2 }, { x: 4, y: 2 });
    expect(sampleInput(s, 2).aim).toBeCloseTo(angleTo({ x: 4, y: 2 }, { x: 0, y: 2 }));
  });
});

describe('엣지 입력', () => {
  it('토글 엣지는 한 번만 전달된다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyF');
    expect(sampleInput(s, 1).toggleFlashlight).toBe(true);
    expect(sampleInput(s, 2).toggleFlashlight).toBe(false);
  });
  it('키를 누르고 있어 자동 반복(keydown)이 와도 엣지를 다시 켜지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyF');
    expect(sampleInput(s, 1).toggleFlashlight).toBe(true);
    onKeyDown(s, 'KeyF'); onKeyDown(s, 'KeyF');
    expect(sampleInput(s, 2).toggleFlashlight).toBe(false);
    onKeyUp(s, 'KeyF'); onKeyDown(s, 'KeyF');
    expect(sampleInput(s, 3).toggleFlashlight).toBe(true);
  });
  it('샘플 사이에 눌렀다 뗀 엣지도 잃지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyG'); onKeyUp(s, 'KeyG');
    expect(sampleInput(s, 1).drop).toBe(true);
    expect(sampleInput(s, 2).drop).toBe(false);
  });
  it('F와 좌클릭은 손전등 토글과 깜빡임을 함께 켠다(서버가 역할에 맞는 쪽만 쓴다)', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyF');
    let i = sampleInput(s, 1);
    expect(i.toggleFlashlight).toBe(true);
    expect(i.flicker).toBe(true);
    onMouseDown(s, 0);
    i = sampleInput(s, 2);
    expect(i.toggleFlashlight).toBe(true);
    expect(i.flicker).toBe(true);
    expect(sampleInput(s, 3).flicker).toBe(false);
  });
  it('좌클릭이 아닌 버튼은 무시한다', () => {
    const s = createInputState();
    onMouseDown(s, 2); onMouseDown(s, 1);
    const i = sampleInput(s, 1);
    expect(i.toggleFlashlight).toBe(false);
    expect(i.flicker).toBe(false);
  });
  it('E는 누르고 있는 동안 레벨, 떼면 꺼진다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyE');
    expect(sampleInput(s, 1).interact).toBe(true);
    expect(sampleInput(s, 2).interact).toBe(true);
    onKeyUp(s, 'KeyE');
    expect(sampleInput(s, 3).interact).toBe(false);
  });
  it('Q는 마우스 월드 위치로 핑 (엣지)', () => {
    const s = createInputState();
    onMouseMove(s, { x: 7.5, y: 2.5 }, { x: 1, y: 1 });
    onKeyDown(s, 'KeyQ');
    expect(sampleInput(s, 1).ping).toEqual({ x: 7.5, y: 2.5 });
    onKeyDown(s, 'KeyQ');
    expect(sampleInput(s, 2).ping).toBeNull();
  });
  it('마우스 위치를 아직 모르면 핑을 보내지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyQ');
    expect(sampleInput(s, 1).ping).toBeNull();
  });
  it('핑 좌표는 이후 마우스 이동에 영향받지 않는 복사본이다', () => {
    const s = createInputState();
    const world = { x: 3, y: 4 };
    onMouseMove(s, world, { x: 0, y: 0 });
    onKeyDown(s, 'KeyQ');
    world.x = 99;
    expect(sampleInput(s, 1).ping).toEqual({ x: 3, y: 4 });
  });
});

describe('칸 선택과 퀵챗', () => {
  it('3만 누르면 칸 2', () => {
    const s = createInputState();
    onKeyDown(s, 'Digit3');
    const i = sampleInput(s, 1);
    expect(i.selectSlot).toBe(2);
    expect(i.chat).toBeNull();
    expect(sampleInput(s, 2).selectSlot).toBeNull();
  });
  it('T+3은 퀵챗 2이고 칸 선택은 바뀌지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyT');
    onKeyDown(s, 'Digit3');
    const i = sampleInput(s, 1);
    expect(i.chat).toBe(2);
    expect(i.selectSlot).toBeNull();
  });
  it('T+1~6은 퀵챗 0~5', () => {
    for (let n = 1; n <= CONFIG.comms.quickChats.length; n++) {
      const s = createInputState();
      onKeyDown(s, 'KeyT'); onKeyDown(s, `Digit${n}`);
      expect(sampleInput(s, 1).chat).toBe(n - 1);
    }
  });
  it('T 없이 4~6은 아무 일도 하지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'Digit5');
    const i = sampleInput(s, 1);
    expect(i.chat).toBeNull();
    expect(i.selectSlot).toBeNull();
  });
  it('T를 뗀 뒤에는 다시 칸 선택', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyT'); onKeyUp(s, 'KeyT');
    onKeyDown(s, 'Digit1');
    expect(sampleInput(s, 1).selectSlot).toBe(0);
  });
  it('퀵챗 숫자의 자동 반복은 다시 보내지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'KeyT'); onKeyDown(s, 'Digit1');
    expect(sampleInput(s, 1).chat).toBe(0);
    onKeyDown(s, 'Digit1');
    expect(sampleInput(s, 2).chat).toBeNull();
  });
});

describe('마우스 휠', () => {
  it('아래로 굴리면 다음 칸, 위로 굴리면 이전 칸 (현재 선택 기준, 0..2 순환)', () => {
    const s = createInputState();
    onWheel(s, 100);
    expect(sampleInput(s, 1).selectSlot).toBe(1);
    onWheel(s, 100);
    expect(sampleInput(s, 2).selectSlot).toBe(2);
    onWheel(s, 100);
    expect(sampleInput(s, 3).selectSlot).toBe(0);
    onWheel(s, -100);
    expect(sampleInput(s, 4).selectSlot).toBe(2);
  });
  it('샘플 전에 여러 번 굴려도 누적해서 최종 칸을 보낸다', () => {
    const s = createInputState();
    onWheel(s, 1); onWheel(s, 1);
    expect(sampleInput(s, 1).selectSlot).toBe(2);
  });
  it('숫자키로 고른 칸이 휠의 기준이 된다', () => {
    const s = createInputState();
    onKeyDown(s, 'Digit3'); sampleInput(s, 1);
    onWheel(s, 1);
    expect(sampleInput(s, 2).selectSlot).toBe(0);
  });
  it('deltaY 0은 무시', () => {
    const s = createInputState();
    onWheel(s, 0);
    expect(sampleInput(s, 1).selectSlot).toBeNull();
  });
});

describe('Escape', () => {
  it('여기서는 다루지 않는다', () => {
    const s = createInputState();
    onKeyDown(s, 'Escape');
    expect(sampleInput(s, 1)).toEqual({
      seq: 1, move: { x: 0, y: 0 }, run: false, aim: 0, toggleFlashlight: false, interact: false,
      drop: false, selectSlot: null, ping: null, chat: null, flicker: false,
    });
  });
});
