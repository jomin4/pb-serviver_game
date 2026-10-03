import { CONFIG } from './config.ts';

/** 헷갈리는 문자(0, O, 1, I)를 뺀 32자. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 방 코드 생성. random은 [0, 1)을 돌려주는 함수(shared는 Math.random을 쓰지 않는다). */
export function generateRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CONFIG.net.roomCodeLength; i++) {
    const idx = Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[idx];
  }
  return code;
}

/** 공백 제거 + 대문자화. 알파벳·길이가 맞지 않으면 null. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.replace(/\s+/g, '').toUpperCase();
  if (code.length !== CONFIG.net.roomCodeLength) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
