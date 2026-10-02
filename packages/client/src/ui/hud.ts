import { CONFIG } from '@bh/shared';
import type { ItemState } from '@bh/shared';
import type { RenderSnapshot } from '../render/visibility.ts';

/**
 * 게임 HUD(스펙 4.5). 캔버스 위에 겹치는 DOM이다. 값이 바뀐 요소만 고친다.
 * 상단: 시계, 트럭 총액 / 목표액, 층. 하단: 소지품 3칸, 체력, 스태미나 막대, 배터리 막대.
 * 좌측: 퀵챗 기록(최근 5개). 연결 상태: 동료 연결 끊김. 잠깐 뜨는 안내(경적 등).
 * 화면 밖 핑 화살표는 캔버스 효과로 그린다(renderer).
 */

/** 게임 시계(분, 0~240)를 "HH:MM"(00:00~04:00)으로. */
export function formatClock(clock: number): string {
  const total = Math.floor(Math.min(CONFIG.roundEndClock, Math.max(0, Number.isFinite(clock) ? clock : 0)));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** HUD가 읽는 방 상태(서버 스키마의 일부). */
export type HudState = {
  clock: number;
  truckTotal: number;
  target: number;
  players: { forEach(cb: (p: { id: string; name: string; connected: boolean }, key: string) => void): void };
};

export type Hud = {
  update(snap: RenderSnapshot, state: HudState): void;
  /** 퀵챗 한 줄을 기록에 더한다. 최근 `CONFIG.fx.chatLogSize`개만 남긴다. */
  pushChat(name: string, text: string): void;
  /** 잠깐 뜨는 안내(`CONFIG.fx.noticeSeconds`초). */
  flash(text: string): void;
  destroy(): void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (testid) e.setAttribute('data-testid', testid);
  return e;
}

/** textContent가 다를 때만 쓴다(매 프레임 호출되므로 DOM 변경을 줄인다). */
function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function setBar(fill: HTMLElement, ratio: number): void {
  const w = `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%`;
  if (fill.style.width !== w) fill.style.width = w;
}

function bar(label: string, testid: string, cls: string): { root: HTMLElement; fill: HTMLElement } {
  const root = el('div', `hud-bar ${cls}`, testid);
  const name = el('span', 'hud-bar-label');
  name.textContent = label;
  const track = el('div', 'hud-bar-track');
  const fill = el('div', 'hud-bar-fill');
  track.append(fill);
  root.append(name, track);
  return { root, fill };
}

export function createHud(host: HTMLElement): Hud {
  const root = el('div', 'hud', 'hud');

  const top = el('div', 'hud-top');
  const clock = el('span', 'hud-clock', 'hud-clock');
  const truck = el('span', 'hud-truck', 'hud-truck');
  const floor = el('span', 'hud-floor', 'hud-floor');
  top.append(clock, truck, floor);

  const chatLog = el('ul', 'hud-chatlog', 'hud-chatlog');
  const notices = el('div', 'hud-notices', 'hud-notices');
  const peers = el('div', 'hud-peers', 'hud-peers');

  const bottom = el('div', 'hud-bottom');
  const slots = el('div', 'hud-slots');
  const slotEls: HTMLElement[] = [];
  for (let i = 0; i < CONFIG.player.slots; i++) {
    const s = el('div', 'hud-slot', `hud-slot-${i}`);
    const key = el('span', 'hud-slot-key');
    key.textContent = String(i + 1);
    const name = el('span', 'hud-slot-name');
    const meta = el('span', 'hud-slot-meta');
    s.append(key, name, meta);
    slots.append(s);
    slotEls.push(s);
  }
  const stats = el('div', 'hud-stats');
  const hp = el('div', 'hud-hp', 'hud-hp');
  const stamina = bar('스태미나', 'hud-stamina', 'stamina');
  const battery = bar('배터리', 'hud-battery', 'battery');
  const ghostTag = el('div', 'hud-ghost', 'hud-ghost');
  stats.append(hp, stamina.root, battery.root, ghostTag);
  bottom.append(slots, stats);

  root.append(top, chatLog, peers, notices, bottom);
  host.append(root);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let lastPeers = '';

  return {
    update(snap, state) {
      const me = snap.self;
      setText(clock, formatClock(state.clock));
      setText(truck, `트럭 ${state.truckTotal} / ${state.target}`);
      setText(floor, me.floor === 0 ? 'B1' : 'B2');

      const byId = new Map<string, ItemState>();
      for (const it of snap.items) byId.set(it.id, it);
      slotEls.forEach((s, i) => {
        const item = me.inventory[i] !== undefined ? byId.get(me.inventory[i]!) : undefined;
        const selected = i === me.selectedSlot;
        if (s.classList.contains('selected') !== selected) s.classList.toggle('selected', selected);
        if (s.classList.contains('empty') !== !item) s.classList.toggle('empty', !item);
        setText(s.children[1] as HTMLElement, item ? item.kind : '비어 있음');
        setText(s.children[2] as HTMLElement, item ? `${item.value} · ${item.weight}kg` : '');
      });

      const maxHp = CONFIG.player.hp;
      const hearts = me.alive ? '♥'.repeat(Math.max(0, Math.min(maxHp, me.hp))) + '♡'.repeat(Math.max(0, maxHp - me.hp)) : '';
      setText(hp, me.alive ? `체력 ${hearts}` : '');
      setBar(stamina.fill, me.stamina / CONFIG.player.staminaMax);
      setBar(battery.fill, me.battery / CONFIG.flashlight.batteryMax);
      stamina.root.classList.toggle('low', me.exhausted);
      setText(ghostTag, me.alive ? '' : '유령');
      root.classList.toggle('ghost', !me.alive);

      const off: string[] = [];
      state.players.forEach((p) => { if (p.id !== snap.selfId && !p.connected) off.push(`${p.name} 연결 끊김`); });
      const key = off.join('\n');
      if (key !== lastPeers) {
        lastPeers = key;
        peers.replaceChildren(...off.map((text) => {
          const line = el('p', 'hud-peer', 'hud-peer-off');
          line.textContent = text;
          return line;
        }));
      }
    },
    pushChat(name, text) {
      const li = el('li', 'hud-chat');
      const who = el('strong', '');
      who.textContent = name;
      li.append(who, document.createTextNode(`: ${text}`));
      chatLog.append(li);
      while (chatLog.children.length > CONFIG.fx.chatLogSize) chatLog.firstElementChild?.remove();
    },
    flash(text) {
      const n = el('p', 'hud-notice', 'hud-notice');
      n.textContent = text;
      notices.append(n);
      const t = setTimeout(() => { n.remove(); timers.delete(t); }, CONFIG.fx.noticeSeconds * 1000);
      timers.add(t);
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      root.remove();
    },
  };
}
