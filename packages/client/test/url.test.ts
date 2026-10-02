import { describe, expect, it } from 'vitest';
import { inviteLink, roomFromUrl } from '../src/net/url.ts';

describe('url', () => {
  it('?room= 코드를 정규화해서 읽는다', () => {
    expect(roomFromUrl('https://x.test/?room=k7m2qx')).toBe('K7M2QX');
  });
  it('잘못된 코드는 null', () => {
    expect(roomFromUrl('https://x.test/?room=zz')).toBeNull();
  });
  it('room 파라미터가 없으면 null', () => {
    expect(roomFromUrl('https://x.test/')).toBeNull();
  });
  it('주소가 잘못되어도 던지지 않고 null', () => {
    expect(roomFromUrl('not a url')).toBeNull();
  });
  it('초대 링크 형식', () => {
    expect(inviteLink('https://x.test', 'K7M2QX')).toBe('https://x.test/?room=K7M2QX');
  });
  it('origin 끝의 슬래시는 중복되지 않는다', () => {
    expect(inviteLink('https://x.test/', 'K7M2QX')).toBe('https://x.test/?room=K7M2QX');
  });
});
