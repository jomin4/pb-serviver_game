import { CONFIG } from '@bh/shared';
import { gainAndPan } from './spatial.ts';
import type { Located } from './spatial.ts';

/**
 * 코드 합성 소리(스펙 4.4). 파일을 읽지 않으므로 로딩 실패 경로가 없다. 오실레이터와 노이즈 버퍼로 만들고,
 * 소리마다 거리 감쇠·좌우 패닝(`gainAndPan`)을 적용해 마스터 게인으로 모은다. 다른 층의 소리는 재생하지 않는다.
 * AudioContext를 못 쓰는 환경(Node, 차단)에서는 모든 메서드가 아무 일도 하지 않는다(경고는 한 번만).
 * 컨텍스트는 첫 사용자 동작 뒤 `unlock()`에서 만든다(브라우저 자동재생 정책, 만들기 전에는 소리 없음).
 */

export type SoundKind = 'stalkerStep' | 'watcherDrag' | 'teammateRun' | 'pickup' | 'buzz' | 'horn' | 'heartbeat' | 'ambient';
/** 계속 이어지는 소리. 나머지는 한 번 울리는 소리(`play`). */
export type LoopKind = 'watcherDrag' | 'ambient';

export type Audio = {
  /** 첫 사용자 동작에서 부른다. 컨텍스트를 만들고/재개한다. 여러 번 불러도 된다. */
  unlock(): void;
  /** 한 번 울리는 소리. `at`이 있으면 거리·층·패닝을 적용하고, 없으면 그대로 들린다. 루프 종류면 `setLoop(kind, true)`와 같다. */
  play(kind: SoundKind, at?: Located): void;
  /** 이어지는 소리를 켜고 끈다. `at`을 다시 주면 위치만 갱신한다(매 프레임 불러도 된다). */
  setLoop(kind: LoopKind, on: boolean, at?: Located): void;
  setListener(listener: Located): void;
  setVolume(v: number): void;
  setEnabled(b: boolean): void;
  /** 이어지는 소리를 모두 멈추고 컨텍스트를 닫는다. 이후 모든 호출은 무시한다. */
  dispose(): void;
  /** 디버그용 현재 상태. */
  state(): { available: boolean; context: string; enabled: boolean; volume: number };
};

// 합성 파라미터(음색): 주파수 Hz, 길이 초. 게임 규칙이 아니라 소리 모양이므로 이곳에 둔다.
const VOICE = {
  noiseSeconds: 1,
  stalkerStep: { from: 95, to: 42, seconds: 0.2, clickHz: 220 },
  teammateRun: { seconds: 0.06, highpassHz: 1800 },
  pickup: { fromHz: 660, toHz: 990, seconds: 0.14 },
  buzz: { seconds: 0.07, bandHz: 3200, humHz: 120 },
  horn: { lowHz: 110, highHz: 139, seconds: 1.6, cutoffHz: 700 },
  heartbeat: { hz: 58, seconds: 0.16, secondBeatDelay: 0.2, secondBeatGain: 0.7 },
  watcherDrag: { bandHz: 420, q: 1.2, wobbleHz: 7, wobbleDepth: 0.35 },
  ambient: { lowHz: 55, detuneHz: 0.7, cutoffHz: 180, swellHz: 0.07, swellDepth: 0.3 },
  attack: 0.005,
  floorGain: 0.0001,
} as const;

type Ctor = typeof AudioContext;
function audioContextCtor(): Ctor | undefined {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext;
}

type LoopVoice = { gain: GainNode; pan: StereoPannerNode | null; stop: () => void };

export function createAudio(): Audio {
  let enabled: boolean = CONFIG.audio.defaultEnabled;
  let volume: number = CONFIG.audio.defaultVolume;
  let listener: Located = { pos: { x: 0, y: 0 }, floor: 0 };
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let disposed = false;
  let failed = false;
  const loops = new Map<LoopKind, LoopVoice>();
  /** 컨텍스트를 만들기 전에 요청된 루프(ambient 등)와 마지막 위치. 만든 뒤 시작한다. */
  const wantedLoops = new Map<LoopKind, Located | undefined>();

  const Ctx = audioContextCtor();
  if (!Ctx) {
    failed = true;
    console.warn('AudioContext is not available; sound is disabled');
  }

  const masterLevel = (): number => (enabled ? volume : 0);
  function applyMaster(): void {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, CONFIG.audio.fadeSeconds);
  }

  function ensureContext(): AudioContext | null {
    if (ctx || disposed || failed || !Ctx) return ctx;
    // 사용자 동작 전에 만들면 브라우저가 경고를 낸다. 동작이 있었던 뒤에만 만든다.
    const activation = (globalThis as { navigator?: { userActivation?: { hasBeenActive: boolean } } }).navigator?.userActivation;
    if (activation && !activation.hasBeenActive) return null;
    try {
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      master.connect(ctx.destination);
      noise = makeNoise(ctx);
    } catch (err) {
      failed = true;
      ctx = null;
      master = null;
      console.warn('AudioContext could not start; sound is disabled', err);
    }
    return ctx;
  }

  function makeNoise(c: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(c.sampleRate * VOICE.noiseSeconds));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    // 소리 질감용 소음이다. 게임 규칙이 아니므로 시드 난수를 쓰지 않는다.
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 소리 하나의 출력 단. 근원이 있으면 층·거리·패닝을 적용한다. 들리지 않으면 null. */
  function output(c: AudioContext, base: number, maxDistance: number, at?: Located): { input: GainNode; end: (t: number) => void } | null {
    let gain = base;
    let pan = 0;
    if (at) {
      const sp = gainAndPan(listener, at, maxDistance);
      if (sp.gain <= 0) return null;
      gain *= sp.gain;
      pan = sp.pan;
    }
    const g = c.createGain();
    g.gain.value = gain;
    let node: AudioNode = g;
    let panner: StereoPannerNode | null = null;
    if (at && typeof c.createStereoPanner === 'function') {
      panner = c.createStereoPanner();
      panner.pan.value = pan;
      g.connect(panner);
      node = panner;
    }
    node.connect(master!);
    return {
      input: g,
      end: (t) => {
        const cleanup = (): void => { try { g.disconnect(); panner?.disconnect(); } catch { /* 이미 끊김 */ } };
        setTimeout(cleanup, Math.max(0, (t - c.currentTime) * 1000) + 50);
      },
    };
  }

  /** 0.005초 안에 올라갔다가 `seconds`에 걸쳐 사라지는 음량 곡선. */
  function envelope(g: GainNode, peak: number, start: number, seconds: number): void {
    g.gain.setValueAtTime(VOICE.floorGain, start);
    g.gain.exponentialRampToValueAtTime(Math.max(VOICE.floorGain, peak), start + VOICE.attack);
    g.gain.exponentialRampToValueAtTime(VOICE.floorGain, start + seconds);
  }

  function osc(c: AudioContext, type: OscillatorType, hz: number): OscillatorNode {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    return o;
  }

  function noiseSource(c: AudioContext, loop: boolean): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = noise;
    s.loop = loop;
    return s;
  }

  function oneShot(c: AudioContext, kind: Exclude<SoundKind, LoopKind>, at?: Located): void {
    const t0 = c.currentTime;
    const vol = CONFIG.audio.volume[kind];
    switch (kind) {
      case 'stalkerStep': {
        const v = VOICE.stalkerStep;
        const out = output(c, vol, CONFIG.audio.maxDistance.stalkerStep, at);
        if (!out) return;
        const o = osc(c, 'sine', v.from);
        o.frequency.exponentialRampToValueAtTime(v.to, t0 + v.seconds);
        const thump = c.createGain();
        o.connect(thump);
        thump.connect(out.input);
        envelope(thump, 1, t0, v.seconds);
        const click = noiseSource(c, false);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = v.clickHz;
        const clickGain = c.createGain();
        click.connect(lp);
        lp.connect(clickGain);
        clickGain.connect(out.input);
        envelope(clickGain, 0.6, t0, v.seconds / 2);
        o.start(t0); o.stop(t0 + v.seconds);
        click.start(t0); click.stop(t0 + v.seconds);
        out.end(t0 + v.seconds);
        return;
      }
      case 'teammateRun': {
        const v = VOICE.teammateRun;
        const out = output(c, vol, CONFIG.audio.maxDistance.teammateRun, at);
        if (!out) return;
        const src = noiseSource(c, false);
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = v.highpassHz;
        const g = c.createGain();
        src.connect(hp); hp.connect(g); g.connect(out.input);
        envelope(g, 1, t0, v.seconds);
        src.start(t0); src.stop(t0 + v.seconds);
        out.end(t0 + v.seconds);
        return;
      }
      case 'pickup': {
        const v = VOICE.pickup;
        const out = output(c, vol, 1, at);
        if (!out) return;
        const o = osc(c, 'triangle', v.fromHz);
        o.frequency.setValueAtTime(v.fromHz, t0);
        o.frequency.exponentialRampToValueAtTime(v.toHz, t0 + v.seconds * 0.6);
        const g = c.createGain();
        o.connect(g); g.connect(out.input);
        envelope(g, 1, t0, v.seconds);
        o.start(t0); o.stop(t0 + v.seconds);
        out.end(t0 + v.seconds);
        return;
      }
      case 'buzz': {
        const v = VOICE.buzz;
        const out = output(c, vol, CONFIG.audio.buzzRange, at);
        if (!out) return;
        const src = noiseSource(c, false);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = v.bandHz;
        const g = c.createGain();
        src.connect(bp); bp.connect(g); g.connect(out.input);
        const hum = osc(c, 'sawtooth', v.humHz);
        const hg = c.createGain();
        hum.connect(hg); hg.connect(out.input);
        envelope(g, 1, t0, v.seconds);
        envelope(hg, 0.3, t0, v.seconds);
        src.start(t0); src.stop(t0 + v.seconds);
        hum.start(t0); hum.stop(t0 + v.seconds);
        out.end(t0 + v.seconds);
        return;
      }
      case 'horn': {
        const v = VOICE.horn;
        const out = output(c, vol, 1);
        if (!out) return;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = v.cutoffHz;
        const g = c.createGain();
        lp.connect(g); g.connect(out.input);
        const a = osc(c, 'sawtooth', v.lowHz);
        const b = osc(c, 'sawtooth', v.highHz);
        a.connect(lp); b.connect(lp);
        envelope(g, 1, t0, v.seconds);
        a.start(t0); a.stop(t0 + v.seconds);
        b.start(t0); b.stop(t0 + v.seconds);
        out.end(t0 + v.seconds);
        return;
      }
      case 'heartbeat': {
        const v = VOICE.heartbeat;
        const out = output(c, vol, 1);
        if (!out) return;
        for (const [delay, level] of [[0, 1], [v.secondBeatDelay, v.secondBeatGain]] as const) {
          const o = osc(c, 'sine', v.hz);
          const g = c.createGain();
          o.connect(g); g.connect(out.input);
          envelope(g, level, t0 + delay, v.seconds);
          o.start(t0 + delay); o.stop(t0 + delay + v.seconds);
        }
        out.end(t0 + v.secondBeatDelay + v.seconds);
        return;
      }
    }
  }

  function startLoop(c: AudioContext, kind: LoopKind, at?: Located): void {
    const g = c.createGain();
    g.gain.value = 0;
    let pan: StereoPannerNode | null = null;
    let tail: AudioNode = g;
    if (kind === 'watcherDrag' && typeof c.createStereoPanner === 'function') {
      pan = c.createStereoPanner();
      g.connect(pan);
      tail = pan;
    }
    tail.connect(master!);
    const stops: Array<() => void> = [];

    if (kind === 'watcherDrag') {
      const v = VOICE.watcherDrag;
      const src = noiseSource(c, true);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = v.bandHz;
      bp.Q.value = v.q;
      const amp = c.createGain();
      amp.gain.value = 1 - v.wobbleDepth;
      const lfo = osc(c, 'sine', v.wobbleHz);
      const depth = c.createGain();
      depth.gain.value = v.wobbleDepth;
      lfo.connect(depth); depth.connect(amp.gain);
      src.connect(bp); bp.connect(amp); amp.connect(g);
      src.start(); lfo.start();
      stops.push(() => { src.stop(); lfo.stop(); });
    } else {
      const v = VOICE.ambient;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = v.cutoffHz;
      const swell = c.createGain();
      swell.gain.value = 1 - v.swellDepth;
      const lfo = osc(c, 'sine', v.swellHz);
      const depth = c.createGain();
      depth.gain.value = v.swellDepth;
      lfo.connect(depth); depth.connect(swell.gain);
      const a = osc(c, 'sawtooth', v.lowHz);
      const b = osc(c, 'sawtooth', v.lowHz + v.detuneHz);
      a.connect(lp); b.connect(lp); lp.connect(swell); swell.connect(g);
      a.start(); b.start(); lfo.start();
      stops.push(() => { a.stop(); b.stop(); lfo.stop(); });
    }
    const voice: LoopVoice = {
      gain: g, pan,
      stop: () => {
        for (const s of stops) { try { s(); } catch { /* 이미 멈춤 */ } }
        try { g.disconnect(); pan?.disconnect(); } catch { /* 이미 끊김 */ }
      },
    };
    loops.set(kind, voice);
    placeLoop(c, kind, voice, at);
  }

  function placeLoop(c: AudioContext, kind: LoopKind, voice: LoopVoice, at?: Located): void {
    const vol = CONFIG.audio.volume[kind];
    let gain = vol;
    let pan = 0;
    if (at && kind === 'watcherDrag') {
      const sp = gainAndPan(listener, at, CONFIG.audio.maxDistance.watcherDrag);
      gain *= sp.gain;
      pan = sp.pan;
    }
    voice.gain.gain.setTargetAtTime(gain, c.currentTime, CONFIG.audio.fadeSeconds);
    if (voice.pan) voice.pan.pan.setTargetAtTime(pan, c.currentTime, CONFIG.audio.fadeSeconds);
  }

  function stopLoop(kind: LoopKind): void {
    const v = loops.get(kind);
    if (!v) return;
    loops.delete(kind);
    v.stop();
  }

  function setLoop(kind: LoopKind, on: boolean, at?: Located): void {
    if (disposed || failed) return;
    if (!on) { wantedLoops.delete(kind); stopLoop(kind); return; }
    wantedLoops.set(kind, at);
    if (!ctx) return;
    try {
      const existing = loops.get(kind);
      if (existing) placeLoop(ctx, kind, existing, at);
      else startLoop(ctx, kind, at);
    } catch (err) { console.warn(`sound ${kind} failed`, err); }
  }

  return {
    unlock() {
      if (disposed) return;
      const c = ensureContext();
      if (!c) return;
      if (c.state === 'suspended') void c.resume().catch(() => {});
      for (const [kind, at] of wantedLoops) if (!loops.has(kind)) startLoop(c, kind, at);
    },
    play(kind, at) {
      if (kind === 'watcherDrag' || kind === 'ambient') { setLoop(kind, true, at); return; }
      if (disposed || failed || !enabled || !ctx || ctx.state !== 'running') return;
      try { oneShot(ctx, kind, at); } catch (err) { console.warn(`sound ${kind} failed`, err); }
    },
    setLoop,
    setListener(l) { listener = l; },
    setVolume(v) {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
      applyMaster();
    },
    setEnabled(b) {
      enabled = b;
      applyMaster();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wantedLoops.clear();
      for (const kind of [...loops.keys()]) stopLoop(kind);
      const c = ctx;
      ctx = null;
      master = null;
      if (c) void c.close().catch(() => {});
    },
    state: () => ({ available: !failed, context: ctx?.state ?? 'none', enabled, volume }),
  };
}
