import { CONFIG } from '@bh/shared';

/**
 * Esc 메뉴(스펙 4.4, 4.6): 소리 켜기/끄기, 음량, 나가기. 설정은 `localStorage`('bh.settings')에 저장한다.
 * 저장소를 못 쓰는 환경(차단, 시크릿 모드, Node)에서도 예외를 던지지 않고 기본값으로 동작한다.
 */

export type Settings = { enabled: boolean; volume: number };

export const SETTINGS_KEY = 'bh.settings';

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const defaults = (): Settings => ({ enabled: CONFIG.audio.defaultEnabled, volume: CONFIG.audio.defaultVolume });

export function loadSettings(): Settings {
  const out = defaults();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return out;
    const { enabled, volume } = parsed as Record<string, unknown>;
    if (typeof enabled === 'boolean') out.enabled = enabled;
    if (typeof volume === 'number' && Number.isFinite(volume)) out.volume = clamp01(volume);
  } catch {
    // 읽기·파싱 실패는 기본값
  }
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: s.enabled, volume: clamp01(s.volume) }));
  } catch {
    // 저장 실패(저장소 차단·용량)는 이번 세션 설정으로만 쓴다
  }
}

export type MenuOptions = {
  /** 메뉴를 붙일 요소(기본 document.body). */
  host?: HTMLElement;
  /** 소리 켜기/끄기·음량이 바뀔 때(저장한 뒤) 부른다. */
  onChange?: (s: Settings) => void;
  /** 메뉴가 닫힐 때(Esc, 나가기 포함) 부른다. */
  onClose?: () => void;
};
export type MenuHandle = { close(): void; isOpen(): boolean };

const soundLabel = (enabled: boolean): string => (enabled ? '소리 끄기' : '소리 켜기');

/** 메뉴를 연다. 닫는 것은 호출한 쪽이 Esc에서 `close()`로 한다(키 처리는 게임 화면이 맡는다). */
export function showMenu(onLeave: () => void, opts: MenuOptions = {}): MenuHandle {
  const settings = loadSettings();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    if (testid) e.setAttribute('data-testid', testid);
    return e;
  };

  const overlay = el('div', 'overlay menu-overlay', 'menu');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '메뉴');
  const panel = el('div', 'menu-panel');
  const title = el('h2', 'menu-title');
  title.textContent = '메뉴';

  const sound = el('button', 'secondary', 'menu-sound');
  sound.type = 'button';
  sound.setAttribute('aria-pressed', String(settings.enabled));
  sound.textContent = soundLabel(settings.enabled);

  const volumeLabel = el('label', 'menu-volume-row');
  const volumeName = el('span', '');
  volumeName.textContent = '음량';
  const volume = el('input', '', 'menu-volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(settings.volume);
  volume.setAttribute('aria-label', '음량');
  volumeLabel.append(volumeName, volume);

  const leave = el('button', 'primary', 'menu-leave');
  leave.type = 'button';
  leave.textContent = '나가기';

  const hint = el('p', 'hint');
  hint.textContent = 'Esc로 닫기';
  panel.append(title, sound, volumeLabel, leave, hint);
  overlay.append(panel);

  const changed = (): void => {
    saveSettings(settings);
    opts.onChange?.({ ...settings });
  };
  sound.addEventListener('click', () => {
    settings.enabled = !settings.enabled;
    sound.textContent = soundLabel(settings.enabled);
    sound.setAttribute('aria-pressed', String(settings.enabled));
    changed();
  });
  volume.addEventListener('input', () => {
    const v = Number(volume.value);
    if (!Number.isFinite(v)) return;
    settings.volume = clamp01(v);
    changed();
  });

  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    overlay.remove();
    opts.onClose?.();
  };
  leave.addEventListener('click', () => {
    close();
    onLeave();
  });

  (opts.host ?? document.body).append(overlay);
  sound.focus();
  return { close, isOpen: () => open };
}
