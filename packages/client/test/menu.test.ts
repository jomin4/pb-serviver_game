import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../src/ui/menu.ts';

const DEFAULTS = { enabled: true, volume: 0.8 };

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('loadSettings', () => {
  it('localStorage가 throw해도 기본 설정', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('localStorage 자체가 없어도 기본 설정', () => {
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('저장된 값이 없으면 기본 설정', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('파싱 실패하면 기본 설정', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'bh.settings': '{not json' }));
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('필드가 잘못되면 그 필드만 기본값, 음량은 0~1로 자른다', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'bh.settings': JSON.stringify({ enabled: 'yes', volume: 7 }) }));
    expect(loadSettings()).toEqual({ enabled: true, volume: 1 });
    vi.stubGlobal('localStorage', memoryStorage({ 'bh.settings': JSON.stringify({ enabled: false, volume: -2 }) }));
    expect(loadSettings()).toEqual({ enabled: false, volume: 0 });
    vi.stubGlobal('localStorage', memoryStorage({ 'bh.settings': 'null' }));
    expect(loadSettings()).toEqual(DEFAULTS);
  });
});

describe('saveSettings', () => {
  it('저장한 값을 다시 읽는다', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    saveSettings({ enabled: false, volume: 0.3 });
    expect(loadSettings()).toEqual({ enabled: false, volume: 0.3 });
  });

  it('setItem이 throw해도 예외를 던지지 않는다', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => saveSettings({ enabled: true, volume: 0.5 })).not.toThrow();
  });
});
