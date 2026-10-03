import { normalizeRoomCode } from '@bh/shared';

/** `?room=` 값을 방 코드로 정규화한다. 없거나 형식이 틀리면 null. */
export function roomFromUrl(href: string): string | null {
  let raw: string | null;
  try {
    raw = new URL(href).searchParams.get('room');
  } catch {
    return null;
  }
  return raw === null ? null : normalizeRoomCode(raw);
}

/** 초대 링크. origin 끝의 슬래시는 정리한다. */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?room=${code}`;
}

/**
 * 방 코드 입력칸의 값을 방 코드로 정규화한다. 초대 링크(`?room=` 포함)를 통째로 붙여 넣었으면 링크에서 꺼낸다
 * (scheme 없는 링크·상대 주소도 받는다). 형식이 틀리면(헷갈리는 문자 0/O/1/I 포함) null.
 */
export function parseRoomInput(raw: string): string | null {
  const text = raw.trim();
  if (text.includes('?room=')) {
    const direct = roomFromUrl(text);
    if (direct !== null) return direct;
    try {
      return roomFromUrl(new URL(text, 'http://localhost/').href);
    } catch {
      return null;
    }
  }
  return normalizeRoomCode(text);
}
