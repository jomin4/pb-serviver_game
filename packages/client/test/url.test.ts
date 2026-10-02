import { describe, expect, it } from 'vitest';
import { inviteLink, parseRoomInput, roomFromUrl } from '../src/net/url.ts';

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

describe('parseRoomInput (방 코드 입력칸)', () => {
  it('공백 제거·대문자화한 6자 코드', () => {
    expect(parseRoomInput(' k7m 2qx ')).toBe('K7M2QX');
  });
  it('헷갈리는 문자(0, O, 1, I)가 있으면 null', () => {
    for (const bad of ['K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI']) expect(parseRoomInput(bad)).toBeNull();
  });
  it('길이가 틀리면 null', () => {
    expect(parseRoomInput('K7M2Q')).toBeNull();
    expect(parseRoomInput('K7M2QXA')).toBeNull();
    expect(parseRoomInput('')).toBeNull();
  });
  it('붙여 넣은 초대 링크에서 코드를 꺼낸다', () => {
    expect(parseRoomInput('https://abc.trycloudflare.com/?room=k7m2qx')).toBe('K7M2QX');
    expect(parseRoomInput('  http://localhost:5173/?room=K7M2QX  ')).toBe('K7M2QX');
  });
  it('scheme 없는 링크나 상대 주소도 받는다', () => {
    expect(parseRoomInput('localhost:5173/?room=k7m2qx')).toBe('K7M2QX');
    expect(parseRoomInput('/?room=k7m2qx')).toBe('K7M2QX');
  });
  it('링크 속 코드가 틀리면 null', () => {
    expect(parseRoomInput('https://x.test/?room=K7M2Q0')).toBeNull();
  });
});
