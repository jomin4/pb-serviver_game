import { CONFIG, getMap } from '@bh/shared';
import type { FloorId, ItemState, LightState, MapData, PlayerInput, Vec } from '@bh/shared';
import { createAudio } from './audio/audio.ts';
import type { Audio } from './audio/audio.ts';
import { createAudioDirector } from './audio/director.ts';
import {
  createInputState, onBlur, onKeyDown, onKeyUp, onMouseDown, onMouseMove, onWheel, sampleInput, setSelectedSlot,
} from './input/keyboard.ts';
import { createSampleClock } from './input/sampleClock.ts';
import { createSender } from './input/sender.ts';
import type { GameRoom } from './net/connection.ts';
import { createCamera } from './render/camera.ts';
import { createRenderer } from './render/renderer.ts';
import type { Renderer } from './render/renderer.ts';
import type { MonsterView, PingView, RenderPlayer, RenderSnapshot } from './render/visibility.ts';
import { createInterpolator } from './sim/interpolation.ts';
import type { Snapshot } from './sim/interpolation.ts';
import { createPredictor } from './sim/prediction.ts';
import type { Predictor } from './sim/prediction.ts';
import { serverTime, toItem, toLight, toMonster, toPlayer } from './sim/snapshot.ts';
import type { ItemSchemaView, LightSchemaView, MonsterSchemaView, PlayerSchemaView } from './sim/snapshot.ts';
import { createHud } from './ui/hud.ts';
import type { Hud } from './ui/hud.ts';
import { loadSettings, showMenu } from './ui/menu.ts';
import type { MenuHandle, Settings } from './ui/menu.ts';
import type { GameElements } from './ui/screens.ts';

/**
 * 게임 화면 한 번(라운드 진행 중, 같은 방 연결 하나)의 수명. 방 상태 → 렌더 스냅숏 → 매 프레임 그리기.
 * - 내 캐릭터: 고정 빈도(`CONFIG.net.inputSampleHz`)로 입력을 샘플링해 즉시 예측 적용(`predictor.apply`), 상태 패치마다 `reconcile`.
 *   조준은 로컬 값을 바로 쓴다(스펙 3.3).
 * - 다른 플레이어·몬스터(그리고 유령인 나): 패치마다 보간기에 넣고 그릴 때 샘플링한다.
 * - 소리: 세션마다 `Audio`를 하나 만들어 프레임·이벤트·상태 변화를 `audioDirector`에 먹인다. Esc는 메뉴(소리·음량·나가기)를 연다.
 * - DOM 입력 리스너, 입력 전송기, rAF 루프, 소리, 메뉴는 `stop()`에서 모두 걷는다.
 */

type MapLike<T> = { forEach(cb: (value: T, key: string) => void): void; get(key: string): T | undefined };
export type GameStateView = {
  mapId: string; clock: number; target: number; truckTotal: number;
  players: MapLike<PlayerSchemaView>; items: MapLike<ItemSchemaView>;
  monsters: MapLike<MonsterSchemaView>; lights: MapLike<LightSchemaView>;
};

export type GameSession = {
  /** 상태 패치가 도착할 때마다 부른다. */
  onState(): void;
  /** 'event' 메시지(GameEvent). */
  onEvent(e: unknown): void;
  stop(): void;
  /** 마지막으로 그린 렌더 스냅숏(디버그용). */
  snapshot(): RenderSnapshot | null;
  /** 소리 상태(디버그용). */
  audioState(): ReturnType<Audio['state']>;
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyE', 'KeyG', 'KeyQ', 'KeyT',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
]);
/** 서버 시각 외삽 상한(초). 패치가 끊겨도 깜빡임·핑 시각이 멀리 달아나지 않게 한다. */
const MAX_TIME_EXTRAPOLATION = 1;
const HORN_TEXT = '트럭 출발 10분 전';
const MONSTER_KEY = (id: string): string => `monster:${id}`;

type HandledEvent =
  | { type: 'chat'; playerId: string; index: number }
  | { type: 'ping'; playerId: string; floor: FloorId; pos: Vec }
  | { type: 'damage'; playerId: string }
  | { type: 'noise'; floor: FloorId; pos: Vec; radius: number }
  | { type: 'horn' };

function asEvent(e: unknown): HandledEvent | null {
  if (typeof e !== 'object' || e === null) return null;
  const r = e as Record<string, unknown>;
  const pos = r.pos as Record<string, unknown> | undefined;
  switch (r.type) {
    case 'chat': return typeof r.playerId === 'string' && typeof r.index === 'number' ? (r as HandledEvent) : null;
    case 'ping':
      return typeof r.playerId === 'string' && (r.floor === 0 || r.floor === 1) && pos && typeof pos.x === 'number' && typeof pos.y === 'number'
        ? (r as HandledEvent) : null;
    case 'damage': return typeof r.playerId === 'string' ? (r as HandledEvent) : null;
    case 'noise':
      return (r.floor === 0 || r.floor === 1) && pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof r.radius === 'number'
        ? (r as HandledEvent) : null;
    case 'horn': return { type: 'horn' };
    default: return null;
  }
}

export function startGame(room: GameRoom, els: GameElements, onLeave: () => void): GameSession {
  const state = room.state as unknown as GameStateView;
  const selfId = room.sessionId;
  const camera = createCamera();
  const input = createInputState();
  const sender = createSender((batch: PlayerInput[]) => {
    try { room.send('input', batch); } catch (err) { console.warn('input send failed', err); }
  });
  const interpolator = createInterpolator();
  const sampleClock = createSampleClock();
  const hud: Hud = createHud(els.hudHost);
  const audio = createAudio();
  const audioDirector = createAudioDirector(audio);
  const applySettings = (s: Settings): void => { audio.setVolume(s.volume); audio.setEnabled(s.enabled); };
  applySettings(loadSettings());
  let menu: MenuHandle | null = null;

  let map: MapData | null = null;
  let predictor: Predictor | null = null;
  let renderer: Renderer | null = null;

  let items: Record<string, ItemState> = {};
  let itemList: ItemState[] = [];
  let players: RenderPlayer[] = [];
  let monsters: MonsterView[] = [];
  let lights: LightState[] = [];
  let self: RenderPlayer | null = null;
  let seq: number | null = null;
  /** 아직 서버가 처리하지 않은 칸 선택 입력의 seq. 처리될 때까지 서버 값으로 덮지 않는다. */
  let pendingSlotSeq: number | null = null;
  let timeBase = 0;
  let timeBaseAt = performance.now();
  let pings: PingView[] = [];
  let mouseScreen: Vec | null = null;
  let lastFrame = performance.now();
  let raf = 0;
  let stopped = false;
  let last: RenderSnapshot | null = null;

  function ensureMap(): MapData | null {
    if (map) return map;
    if (!state.mapId) return null;
    try {
      map = getMap(state.mapId);
    } catch (err) {
      console.error('unknown map', state.mapId, err);
      return null;
    }
    predictor = createPredictor(map);
    renderer = createRenderer(els.canvas, map, camera);
    return map;
  }

  function now(): number { return performance.now(); }
  function currentTime(t = now()): number {
    return timeBase + Math.min(MAX_TIME_EXTRAPOLATION, Math.max(0, (t - timeBaseAt) / 1000));
  }

  function onState(): void {
    if (stopped || !state?.players) return;
    if (!ensureMap() || !predictor) return;
    const t = now();
    const nextItems: Record<string, ItemState> = {};
    const nextList: ItemState[] = [];
    state.items.forEach((s) => { const it = toItem(s); nextItems[it.id] = it; nextList.push(it); });
    items = nextItems;
    itemList = nextList;
    const nextPlayers: RenderPlayer[] = [];
    state.players.forEach((s) => nextPlayers.push(toPlayer(s)));
    players = nextPlayers;
    const nextMonsters: MonsterView[] = [];
    state.monsters.forEach((s) => nextMonsters.push(toMonster(s)));
    monsters = nextMonsters;
    const nextLights: LightState[] = [];
    state.lights.forEach((s) => nextLights.push(toLight(s)));
    lights = nextLights;

    const server = players.find((p) => p.id === selfId);
    if (server) {
      audioDirector.onInventory(server.inventory.length);
      if (seq === null || seq <= server.lastSeq) seq = server.lastSeq + 1;
      if (pendingSlotSeq !== null && server.lastSeq >= pendingSlotSeq) pendingSlotSeq = null;
      const localSlot = pendingSlotSeq !== null || input.slotPick !== null;
      if (!localSlot) setSelectedSlot(input, server.selectedSlot);
      const reconciled = predictor.reconcile(server, items);
      self = {
        ...reconciled, colorIndex: server.colorIndex, aim: self?.aim ?? server.aim,
        selectedSlot: localSlot ? input.selectedSlot : server.selectedSlot,
      };
    }

    const snap: Snapshot = {};
    for (const p of players) snap[p.id] = { pos: p.pos, floor: p.floor, aim: p.aim };
    for (const m of monsters) snap[MONSTER_KEY(m.id)] = { pos: m.pos, floor: m.floor };
    interpolator.push(t, snap);

    timeBase = serverTime(state.clock);
    timeBaseAt = t;
  }

  function onEvent(raw: unknown): void {
    if (stopped) return;
    const e = asEvent(raw);
    if (!e) return;
    switch (e.type) {
      case 'chat': {
        const text = CONFIG.comms.quickChats[e.index];
        if (text === undefined) return;
        const name = state.players.get(e.playerId)?.name ?? '?';
        hud.pushChat(name, text);
        return;
      }
      case 'ping':
        pings.push({ pos: { x: e.pos.x, y: e.pos.y }, floor: e.floor, until: currentTime() + CONFIG.comms.pingSeconds });
        return;
      case 'damage':
        if (e.playerId === selfId) renderer?.shake();
        return;
      case 'noise':
        audioDirector.onNoise(e);
        return;
      case 'horn':
        hud.flash(HORN_TEXT);
        audioDirector.onHorn();
        return;
    }
  }

  function frame(): void {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const t = now();
    const dt = (t - lastFrame) / 1000;
    lastFrame = t;
    if (!self || !predictor || !renderer || seq === null) return;

    const sampled = interpolator.sample(t);
    // 유령은 예측하지 않으므로 보간한 위치로 본다
    const ghostPose = !self.alive ? sampled[selfId] : undefined;
    const viewPos = ghostPose ? ghostPose.pos : self.pos;

    camera.follow(viewPos);
    if (mouseScreen) onMouseMove(input, camera.screenToWorld(mouseScreen), viewPos);
    // 입력은 rAF 주기가 아니라 고정 빈도(CONFIG.net.inputSampleHz)로 샘플링한다. 엣지 플래그는 샘플링될 때까지
    // InputState에 남아 있으므로 샘플을 만들지 않는 프레임에도 사라지지 않는다. 예측은 샘플마다 고정 dt로 적용한다.
    const samples = sampleClock.advance(dt);
    for (let i = 0; i < samples; i++) {
      const inp = sampleInput(input, seq++);
      if (inp.selectSlot !== null) pendingSlotSeq = inp.seq;
      sender.push(inp);
      const moved = predictor.apply(inp, self, items, sampleClock.step);
      self = { ...moved, colorIndex: self.colorIndex, aim: input.aim, selectedSlot: inp.selectSlot ?? self.selectedSlot };
    }
    self = { ...self, aim: input.aim };

    const me: RenderPlayer = ghostPose ? { ...self, pos: ghostPose.pos, floor: ghostPose.floor } : self;
    const time = currentTime(t);
    pings = pings.filter((p) => p.until > time);
    const others = players.filter((p) => p.id !== selfId).map((p) => {
      const pose = sampled[p.id];
      return pose ? { ...p, pos: pose.pos, floor: pose.floor, aim: pose.aim ?? p.aim } : p;
    });
    const snap: RenderSnapshot = {
      selfId,
      self: me,
      players: [...others, me],
      items: itemList,
      monsters: monsters.map((m) => {
        const pose = sampled[MONSTER_KEY(m.id)];
        return pose ? { ...m, pos: pose.pos, floor: pose.floor } : m;
      }),
      lights,
      time,
      pings,
    };
    last = snap;
    renderer.draw(snap);
    hud.update(snap, state);
    audioDirector.update(snap, Math.min(dt, CONFIG.net.maxDt));
  }

  // ------------------------------------------------------------------ DOM

  function layout(): void {
    camera.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    const c = els.canvas;
    if (c.width !== camera.pixelWidth) c.width = camera.pixelWidth;
    if (c.height !== camera.pixelHeight) c.height = camera.pixelHeight;
    els.stage.style.width = `${camera.cssWidth}px`;
    els.stage.style.height = `${camera.cssHeight}px`;
    els.stage.style.setProperty('--hud-scale', String(camera.scale));
  }

  const isGameKey = (e: KeyboardEvent): boolean => GAME_KEYS.has(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey;
  /** Esc: 메뉴를 열고 닫는다. 열 때 눌려 있던 키를 모두 놓아 캐릭터가 멈춘다. */
  function toggleMenu(): void {
    if (menu?.isOpen()) { menu.close(); return; }
    onBlur(input);
    menu = showMenu(onLeave, {
      host: els.stage,
      onChange: (s) => { applySettings(s); audio.unlock(); },
      onClose: () => { menu = null; },
    });
  }

  const keydown = (e: KeyboardEvent): void => {
    audio.unlock();
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) toggleMenu();
      return;
    }
    if (menu || !isGameKey(e)) return; // 메뉴가 열려 있으면 게임 키는 받지 않는다
    e.preventDefault();
    onKeyDown(input, e.code);
  };
  const keyup = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    onKeyUp(input, e.code);
  };
  const blur = (): void => onBlur(input);
  const mousemove = (e: MouseEvent): void => {
    const r = els.canvas.getBoundingClientRect();
    mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const mousedown = (e: MouseEvent): void => {
    e.preventDefault();
    audio.unlock();
    mousemove(e);
    if (!menu) onMouseDown(input, e.button);
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    onWheel(input, e.deltaY);
  };
  const contextmenu = (e: Event): void => e.preventDefault();

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  window.addEventListener('mousemove', mousemove);
  window.addEventListener('resize', layout);
  els.canvas.addEventListener('mousedown', mousedown);
  els.canvas.addEventListener('wheel', wheel, { passive: false });
  els.canvas.addEventListener('contextmenu', contextmenu);

  layout();
  audio.unlock();
  onState();
  sender.start();
  raf = requestAnimationFrame(frame);

  return {
    onState,
    onEvent,
    snapshot: () => last,
    audioState: () => audio.state(),
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      sender.flush();
      sender.stop();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('mousemove', mousemove);
      window.removeEventListener('resize', layout);
      els.canvas.removeEventListener('mousedown', mousedown);
      els.canvas.removeEventListener('wheel', wheel);
      els.canvas.removeEventListener('contextmenu', contextmenu);
      menu?.close();
      audioDirector.stop();
      audio.dispose();
      hud.destroy();
    },
  };
}
