import { describe, expect, it } from 'vitest';
import { dedupeNickname, nextHost, validateNickname } from '../src/lobby.ts';

describe('lobby', () => {
  it('닉네임 trim 후 1~10자', () => {
    expect(validateNickname('  철수 ')).toBe('철수');
    expect(validateNickname('')).toBeNull();
    expect(validateNickname('가'.repeat(11))).toBeNull();
    expect(validateNickname('가'.repeat(10))).toBe('가'.repeat(10));
  });
  it('공백뿐이거나 문자열이 아니면 null', () => {
    expect(validateNickname('   ')).toBeNull();
    expect(validateNickname(undefined)).toBeNull();
    expect(validateNickname(42)).toBeNull();
    expect(validateNickname(null)).toBeNull();
  });
  it('중복 닉네임에 접미사', () => {
    expect(dedupeNickname('철수', ['철수', '철수(2)'])).toBe('철수(3)');
    expect(dedupeNickname('철수', ['철수'])).toBe('철수(2)');
    expect(dedupeNickname('철수', ['영희'])).toBe('철수');
    expect(dedupeNickname('철수', [])).toBe('철수');
  });
  it('방장은 가장 먼저 들어온 사람', () => {
    expect(nextHost([{ id: 'b', joinOrder: 2 }, { id: 'a', joinOrder: 1 }])).toBe('a');
  });
  it('남은 사람이 없으면 방장도 없다', () => {
    expect(nextHost([])).toBeNull();
  });
});
