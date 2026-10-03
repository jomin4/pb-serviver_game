import { angleTo, CONFIG, EMPTY_INPUT, normalize } from '@bh/shared';
import type { PlayerInput, Vec } from '@bh/shared';

/**
 * 키보드·마우스 이벤트를 `PlayerInput`으로 바꾼다 (스펙 4.6).
 * DOM·전역에 접근하지 않는다. 이벤트 값(`KeyboardEvent.code`, 버튼 번호, deltaY, 월드 좌표)을 인자로 받는다.
 * 키는 `code` 기준이라 한글 입력 모드에서도 같은 물리 키로 동작한다. Esc는 여기서 다루지 않는다(메뉴).
 */
type Slot = 0 | 1 | 2;
type Chat = 0 | 1 | 2 | 3 | 4 | 5;

export type InputState = {
  /** 지금 눌려 있는 `code` 집합. 자동 반복 keydown을 걸러내는 데도 쓴다. */
  held: Set<string>;
  aim: number;
  /** 마우스의 마지막 월드 좌표. 아직 모르면 null. */
  mouseWorld: Vec | null;
  /** 현재 선택된 칸. 숫자키·휠이 갱신하고, 휠은 이것을 기준으로 움직인다. */
  selectedSlot: Slot;
  // 엣지 플래그: sampleInput이 읽고 지운다.
  toggle: boolean;
  drop: boolean;
  slotPick: Slot | null;
  ping: Vec | null;
  chat: Chat | null;
};

const KEY = {
  up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD',
  runL: 'ShiftLeft', runR: 'ShiftRight',
  flashlight: 'KeyF', interact: 'KeyE', drop: 'KeyG', ping: 'KeyQ', chatModifier: 'KeyT',
} as const;
const DIGIT = /^Digit([1-9])$/;
const LEFT_BUTTON = 0;

export function createInputState(): InputState {
  return { held: new Set(), aim: 0, mouseWorld: null, selectedSlot: 0, toggle: false, drop: false, slotPick: null, ping: null, chat: null };
}

export function onKeyDown(s: InputState, code: string): void {
  if (s.held.has(code)) return; // 자동 반복: 엣지를 다시 만들지 않는다
  s.held.add(code);
  switch (code) {
    case KEY.flashlight: s.toggle = true; return;
    case KEY.drop: s.drop = true; return;
    case KEY.ping:
      if (s.mouseWorld) s.ping = { x: s.mouseWorld.x, y: s.mouseWorld.y };
      return;
  }
  const digit = DIGIT.exec(code);
  if (!digit) return;
  const index = Number(digit[1]) - 1;
  if (s.held.has(KEY.chatModifier)) {
    // T를 누른 동안 숫자는 퀵챗 전용이다. 칸 선택은 바뀌지 않는다.
    if (index < CONFIG.comms.quickChats.length) s.chat = index as Chat;
  } else if (index < CONFIG.player.slots) {
    selectSlot(s, index as Slot);
  }
}

export function onKeyUp(s: InputState, code: string): void {
  s.held.delete(code);
}

/** 창이 포커스를 잃으면 keyup이 오지 않을 수 있으므로 눌린 키(이동·뛰기·상호작용·T)를 모두 해제한다. */
export function onBlur(s: InputState): void {
  s.held.clear();
}

/** 마우스가 가리키는 월드 좌표와 내 위치로 조준각을 갱신한다. 핑 좌표로도 쓴다. */
export function onMouseMove(s: InputState, worldPos: Vec, playerPos: Vec): void {
  s.mouseWorld = { x: worldPos.x, y: worldPos.y };
  s.aim = angleTo(playerPos, worldPos);
}

/**
 * 좌클릭은 손전등 토글(산 사람) 또는 형광등 깜빡이기(유령)다. 같은 엣지를 두 역할 모두에 실어 보내고
 * 서버가 자기 상태에 맞는 쪽만 쓴다(`sampleInput`에서 `toggleFlashlight`와 `flicker`를 함께 켠다).
 */
export function onMouseDown(s: InputState, button: number): void {
  if (button === LEFT_BUTTON) s.toggle = true;
}

/** deltaY > 0은 다음 칸, < 0은 이전 칸. 현재 선택 기준으로 0..slots-1을 순환한다. */
export function onWheel(s: InputState, deltaY: number): void {
  if (deltaY === 0 || Number.isNaN(deltaY)) return;
  const n = CONFIG.player.slots;
  selectSlot(s, ((s.selectedSlot + (deltaY > 0 ? 1 : -1) + n) % n) as Slot);
}

/** 서버가 알려준 선택 칸으로 맞춘다(휠 기준 동기화). 보낼 입력은 만들지 않는다. */
export function setSelectedSlot(s: InputState, slot: Slot): void {
  s.selectedSlot = slot;
}

function selectSlot(s: InputState, slot: Slot): void {
  s.selectedSlot = slot;
  s.slotPick = slot;
}

/** 지금 상태로 입력 하나를 만든다. 엣지 플래그는 초기화한다. 이동·뛰기·상호작용은 눌려 있는 상태(레벨)를 반영한다. */
export function sampleInput(s: InputState, seq: number): PlayerInput {
  const h = s.held;
  const dir = { x: Number(h.has(KEY.right)) - Number(h.has(KEY.left)), y: Number(h.has(KEY.down)) - Number(h.has(KEY.up)) };
  const input: PlayerInput = {
    ...EMPTY_INPUT(seq),
    move: normalize(dir),
    run: h.has(KEY.runL) || h.has(KEY.runR),
    aim: s.aim,
    toggleFlashlight: s.toggle,
    flicker: s.toggle,
    interact: h.has(KEY.interact),
    drop: s.drop,
    selectSlot: s.slotPick,
    ping: s.ping,
    chat: s.chat,
  };
  s.toggle = false; s.drop = false; s.slotPick = null; s.ping = null; s.chat = null;
  return input;
}
