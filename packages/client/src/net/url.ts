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
