import { CONFIG } from '@bh/shared';

/** 앞뒤 공백을 지운 뒤 1~nicknameMax자면 그 문자열, 아니면 null. */
export function validateNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > CONFIG.net.nicknameMax) return null;
  return name;
}

/** 이미 쓰는 이름이면 `이름(2)`, `이름(3)`…으로 바꾼다. */
export function dedupeNickname(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name}(${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** 남은 사람 중 가장 먼저 들어온(joinOrder 최소) 사람의 id. */
export function nextHost(players: { id: string; joinOrder: number }[]): string | null {
  let best: { id: string; joinOrder: number } | null = null;
  for (const p of players) if (!best || p.joinOrder < best.joinOrder) best = p;
  return best ? best.id : null;
}
