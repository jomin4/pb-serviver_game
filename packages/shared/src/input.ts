import { CONFIG } from './config.ts';
import { angleDiff, len, normalize } from './geometry.ts';
import type { PlayerInput, Vec } from './types.ts';

/** 아무 것도 누르지 않은 입력. */
export const EMPTY_INPUT = (seq: number): PlayerInput => ({
  seq, move: { x: 0, y: 0 }, run: false, aim: 0, toggleFlashlight: false,
  interact: false, drop: false, selectSlot: null, ping: null, chat: null, flicker: false,
});

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finiteOr0 = (v: unknown): number => (finite(v) ? v : 0);

function cleanMove(v: unknown): Vec {
  if (!isRecord(v)) return { x: 0, y: 0 };
  const m = { x: finiteOr0(v.x), y: finiteOr0(v.y) };
  const l = len(m);
  // 성분이 매우 크면 len이 Infinity가 되므로 그 경우도 정규화 대상이다.
  return l > 1 || !Number.isFinite(l) ? normalize(scaleDown(m)) : m;
}

/** 오버플로 방지: 최대 성분으로 먼저 나눈다. */
function scaleDown(v: Vec): Vec {
  const k = Math.max(Math.abs(v.x), Math.abs(v.y));
  return k === 0 ? v : { x: v.x / k, y: v.y / k };
}

/** 각도를 (−π, π]로 감싼다. 유한하지 않으면 0. */
function cleanAim(v: unknown): number {
  if (!finite(v)) return 0;
  const a = angleDiff(v, 0); // [−π, π)
  return a === -Math.PI ? Math.PI : a;
}

function cleanPing(v: unknown): Vec | null {
  if (!isRecord(v) || !finite(v.x) || !finite(v.y)) return null;
  return { x: v.x, y: v.y };
}

/** 0 이상 count 미만 정수만 통과, 아니면 null. */
const cleanIndex = (v: unknown, count: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count ? v : null;

/** 클라이언트가 보낸 신뢰할 수 없는 입력을 PlayerInput으로 정리한다. 던지지 않는다. */
export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (!isRecord(raw)) return null;
  const { seq } = raw;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
  return {
    seq,
    move: cleanMove(raw.move),
    run: raw.run === true,
    aim: cleanAim(raw.aim),
    toggleFlashlight: raw.toggleFlashlight === true,
    interact: raw.interact === true,
    drop: raw.drop === true,
    selectSlot: cleanIndex(raw.selectSlot, CONFIG.player.slots) as PlayerInput['selectSlot'],
    ping: cleanPing(raw.ping),
    chat: cleanIndex(raw.chat, CONFIG.comms.quickChats.length) as PlayerInput['chat'],
    flicker: raw.flicker === true,
  };
}

/** 입력 배열을 앞에서 maxInputsPerBatch개까지만 보고, 유효한 것만 돌려준다. */
export function sanitizeBatch(raw: unknown): PlayerInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayerInput[] = [];
  for (const item of raw.slice(0, CONFIG.net.maxInputsPerBatch)) {
    const input = sanitizeInput(item);
    if (input) out.push(input);
  }
  return out;
}
