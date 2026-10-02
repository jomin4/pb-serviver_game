import { CONFIG } from '@bh/shared';
import type { PlayerView, RoomView } from '../net/connection.ts';

/**
 * 화면 그리기. 상태를 갖지 않는다: 호출할 때마다 #app을 새로 채우고, 사용자 동작은 콜백으로만 알린다.
 * (재접속 안내만 #app 위에 덮는 별도 층이다.)
 */

type Child = Node | string | null | false | undefined;
type Attrs = { class?: string; testid?: string; [key: string]: string | undefined };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'testid') el.setAttribute('data-testid', value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

function root(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app not found');
  return el;
}

function mount(...nodes: Child[]): void {
  root().replaceChildren(h('main', { class: 'screen' }, ...nodes));
}

function mountWide(...nodes: Child[]): void {
  root().replaceChildren(h('main', { class: 'screen wide' }, ...nodes));
}

const NICKNAME_HINT = '닉네임은 1~10자로 입력해 주세요';
const CODE_HINT = '방을 찾을 수 없습니다. 코드를 확인해 주세요';

/** 앞뒤 공백을 지운 닉네임이 1~nicknameMax자면 그 값, 아니면 null(서버 규칙과 같다). */
function cleanNickname(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= CONFIG.net.nicknameMax ? name : null;
}

export type HomeOptions = {
  /** 초대 링크로 연 경우의 방 코드. 있으면 닉네임만 묻는다. */
  presetCode?: string | null;
  /** 이전에 입력한 값(다시 시도할 때 채워 둔다). */
  name?: string;
  code?: string;
};

export function showHome(
  onCreate: (name: string) => void,
  onJoin: (code: string, name: string) => void,
  opts: HomeOptions = {},
): void {
  const preset = opts.presetCode ?? null;
  const nameInput = h('input', {
    type: 'text', testid: 'nickname-input', maxlength: String(CONFIG.net.nicknameMax),
    placeholder: '닉네임 (1~10자)', autocomplete: 'off', value: opts.name ?? '',
  });
  const nameError = h('p', { class: 'field-error', testid: 'nickname-error', role: 'alert' });
  const codeInput = h('input', {
    type: 'text', testid: 'code-input', maxlength: '8', placeholder: '방 코드 6자리',
    autocomplete: 'off', autocapitalize: 'characters', value: opts.code ?? '',
  });
  const codeError = h('p', { class: 'field-error', testid: 'code-error', role: 'alert' });

  const checkName = (): string | null => {
    const name = cleanNickname(nameInput.value);
    nameError.textContent = name === null ? NICKNAME_HINT : '';
    return name;
  };
  const trimmedCode = (): string => codeInput.value.replace(/\s+/g, '').toUpperCase();

  let touched = nameInput.value !== '';
  nameInput.addEventListener('input', () => { touched = true; checkName(); });
  nameInput.addEventListener('blur', () => { if (touched) checkName(); });

  const create = (): void => {
    const name = checkName();
    if (name !== null) onCreate(name);
  };
  const join = (code: string): void => {
    const name = checkName();
    if (!/^[A-Z0-9]{6}$/.test(code)) { codeError.textContent = CODE_HINT; return; }
    codeError.textContent = '';
    if (name !== null) onJoin(code, name);
  };

  const createButton = h('button', { type: 'button', class: preset ? 'secondary' : 'primary', testid: 'create-button' }, preset ? '새 방 만들기' : '방 만들기');
  createButton.addEventListener('click', create);

  if (preset) {
    const joinButton = h('button', { type: 'button', class: 'primary', testid: 'join-button' }, '입장');
    joinButton.addEventListener('click', () => join(preset));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(preset); });
    mount(
      h('h1', {}, '지하주차장'),
      h('p', { class: 'invite' }, '초대받은 방 ', h('strong', { class: 'code', testid: 'invite-code' }, preset)),
      h('label', { class: 'field' }, h('span', {}, '닉네임'), nameInput, nameError),
      h('div', { class: 'row' }, joinButton, createButton),
    );
  } else {
    const joinButton = h('button', { type: 'button', class: 'secondary', testid: 'join-button' }, '입장');
    joinButton.addEventListener('click', () => join(trimmedCode()));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(trimmedCode()); });
    codeInput.addEventListener('input', () => { codeError.textContent = ''; });
    mount(
      h('h1', {}, '지하주차장'),
      h('label', { class: 'field' }, h('span', {}, '닉네임'), nameInput, nameError),
      h('div', { class: 'row' }, createButton),
      h('p', { class: 'divider' }, '또는 방 코드로 입장'),
      h('div', { class: 'field' }, h('div', { class: 'row' }, codeInput, joinButton), codeError),
    );
  }
  nameInput.focus();
}

function sortedPlayers(state: RoomView): PlayerView[] {
  const list: PlayerView[] = [];
  state.players.forEach((p) => list.push(p));
  return list.sort((a, b) => a.joinOrder - b.joinOrder);
}

function swatch(p: PlayerView): HTMLElement {
  return h('span', { class: `swatch c${p.colorIndex % 4}`, 'aria-hidden': 'true' });
}

export function showLobby(
  state: RoomView,
  isHost: boolean,
  onStart: () => void,
  link: string,
  onLeave?: () => void,
): void {
  const players = sortedPlayers(state);
  const code = new URL(link).searchParams.get('room') ?? '';

  const linkInput = h('input', { type: 'text', readonly: '', class: 'link', testid: 'invite-link', value: link, 'aria-label': '초대 링크' });
  const copyStatus = h('p', { class: 'hint', testid: 'copy-status', role: 'status' });
  const copyButton = h('button', { type: 'button', class: 'secondary', testid: 'copy-link-button' }, '링크 복사');
  copyButton.addEventListener('click', () => {
    const fallback = (): void => {
      linkInput.focus();
      linkInput.select();
      copyStatus.textContent = '링크를 선택했습니다. Ctrl+C로 복사해 주세요';
    };
    if (!navigator.clipboard) { fallback(); return; }
    navigator.clipboard.writeText(link).then(
      () => { copyStatus.textContent = '링크를 복사했습니다'; },
      fallback,
    );
  });

  const list = h('ul', { class: 'players', testid: 'player-list' }, ...players.map((p) =>
    h('li', { class: 'player', testid: 'player-item' },
      swatch(p),
      h('span', { class: 'name' }, p.name),
      p.isHost && h('span', { class: 'badge', testid: 'host-badge' }, '방장'),
      !p.connected && h('span', { class: 'badge off' }, '연결 끊김'),
    )));

  const startButton = h('button', { type: 'button', class: 'primary', testid: 'start-button' }, '시작');
  startButton.disabled = !isHost;
  startButton.addEventListener('click', () => { if (isHost) onStart(); });

  const leaveButton = onLeave && h('button', { type: 'button', class: 'link-button', testid: 'leave-button' }, '나가기');
  if (leaveButton && onLeave) leaveButton.addEventListener('click', onLeave);

  mount(
    h('h1', {}, '대기실'),
    h('p', { class: 'invite' }, '방 코드 ', h('strong', { class: 'code', testid: 'room-code' }, code)),
    h('div', { class: 'row' }, linkInput, copyButton),
    copyStatus,
    h('h2', {}, `참가자 ${players.length}/${CONFIG.maxPlayers}`),
    list,
    h('div', { class: 'row' }, startButton),
    !isHost && h('p', { class: 'hint', testid: 'wait-host' }, '방장이 시작하기를 기다리는 중…'),
    leaveButton,
  );
}

export function showResult(state: RoomView, onAgain: () => void): void {
  const success = state.result === 'success';
  const players = sortedPlayers(state);

  const table = h('table', { class: 'result-table', testid: 'result-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '플레이어'), h('th', { class: 'num' }, '운반액'), h('th', {}, '생존 여부'))),
    h('tbody', {}, ...players.map((p) =>
      h('tr', { testid: 'result-row' },
        h('td', {}, swatch(p), p.name),
        h('td', { class: 'num', testid: 'result-carried' }, String(p.carriedTotal)),
        h('td', { testid: 'result-alive' }, p.alive ? '생존' : '사망'),
      ))),
  );

  const againButton = h('button', { type: 'button', class: 'primary', testid: 'again-button' }, '한 판 더');
  againButton.addEventListener('click', onAgain);

  mount(
    h('h1', { class: success ? 'ok' : 'bad', testid: 'result-title' }, success ? '성공' : '실패'),
    h('dl', { class: 'totals' },
      h('dt', {}, '트럭 총액'), h('dd', { testid: 'result-truck' }, String(state.truckTotal)),
      h('dt', {}, '목표액'), h('dd', { testid: 'result-target' }, String(state.target)),
    ),
    table,
    h('div', { class: 'row' }, againButton),
  );
}

/** 게임 화면 자리표시. 렌더링과 입력은 Task 18에서 이 함수를 대체한다. */
export function showGamePlaceholder(): void {
  mountWide(
    h('canvas', { width: '960', height: '540', class: 'game-canvas', testid: 'game-canvas' }),
    h('p', { class: 'hint', testid: 'game-placeholder' }, '게임 화면 (Task 18)'),
  );
}

export function showError(message: string, onRetry?: () => void, actionLabel = '다시 시도'): void {
  const button = onRetry && h('button', { type: 'button', class: 'primary', testid: 'retry-button' }, actionLabel);
  if (button && onRetry) button.addEventListener('click', onRetry);
  mount(
    h('p', { class: 'error-text', testid: 'error-text', role: 'alert' }, message),
    button ? h('div', { class: 'row' }, button) : null,
  );
}

const RECONNECT_ID = 'reconnecting-overlay';

/** 화면 위에 덮는 재접속 안내. 다시 부르면 숫자만 바꾼다. */
export function showReconnecting(secondsLeft: number): void {
  const text = `재연결 중… (${secondsLeft}초)`;
  const existing = document.getElementById(RECONNECT_ID);
  if (existing) {
    const label = existing.querySelector('p');
    if (label) label.textContent = text;
    return;
  }
  document.body.append(h('div', { id: RECONNECT_ID, class: 'overlay', testid: 'reconnecting' }, h('p', { role: 'status' }, text)));
}

export function hideReconnecting(): void {
  document.getElementById(RECONNECT_ID)?.remove();
}

/** 잠깐 떴다 사라지는 안내(라운드 오류 등). */
export function showNotice(message: string, ms = 5000): void {
  const el = h('div', { class: 'notice', testid: 'notice', role: 'alert' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
