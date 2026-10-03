import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateRoomCode, normalizeRoomCode } from '../src/roomCode.ts';

describe('roomCode', () => {
  it('코드는 6자이고 0,O,1,I가 없다', () => {
    for (let i = 0; i < 500; i++) expect(generateRoomCode(Math.random)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it('알파벳은 32자', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  });
  it('주어진 난수 함수만 사용한다(결정적)', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA');
    expect(generateRoomCode(() => 0.999999)).toBe('999999');
  });
  it('소문자·공백 정규화', () => {
    expect(normalizeRoomCode(' k7m2qx ')).toBe('K7M2QX');
    expect(normalizeRoomCode('k7m 2qx')).toBe('K7M2QX');
  });
  it('헷갈리는 문자가 섞이면 null', () => {
    expect(normalizeRoomCode('K7M2Q0')).toBeNull();
  });
  it('길이가 6이 아니면 null', () => {
    expect(normalizeRoomCode('K7M2Q')).toBeNull();
    expect(normalizeRoomCode('K7M2QXA')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });
});
