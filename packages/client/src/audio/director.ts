import { CONFIG, dist } from '@bh/shared';
import type { FloorId, Vec } from '@bh/shared';
import { dangerDistance, isLightLit } from '../render/visibility.ts';
import type { RenderSnapshot } from '../render/visibility.ts';
import type { Audio } from './audio.ts';

/**
 * 게임 상태가 어떤 소리를 낼지 정한다(스펙 4.4). 프레임마다 렌더 스냅숏을 받아 `Audio`를 부른다.
 * DOM·Web Audio를 직접 쓰지 않으므로 가짜 `Audio`로 Node에서 시험한다. 시간은 `update(dt)`로만 흐른다.
 * - 추적형: 보간한 위치가 움직이는 동안(모드 무관) `stalkerStepInterval`마다 발소리.
 * - 시선형: 활성 && moving && !frozen && 같은 층이면 끌리는 소리를 이어서.
 * - 깜빡이는 형광등(내 층, `buzzRange` 안): 빛나는 쪽으로 바뀔 때마다 지직(렌더러와 같은 `isLightLit` 규칙).
 * - 심장 소리: 긴장 효과 조건(`dangerDistance`, 산 사람만)일 때 가까울수록 빠르게.
 * - 동료 뛰는 소리: 내 것이 아닌 `noise.run` 소음 이벤트.
 */

export type AudioSink = Pick<Audio, 'play' | 'setLoop' | 'setListener'>;
export type NoiseEvent = { floor: FloorId; pos: Vec; radius: number };

export type AudioDirector = {
  update(snap: RenderSnapshot, dt: number): void;
  /** 소음 이벤트. 내 소음(내 위치 가까이)은 건너뛴다. */
  onNoise(e: NoiseEvent): void;
  /** 내 소지품 개수가 서버 상태에서 바뀔 때마다 부른다. 늘면 줍는 소리. 처음 부르는 값은 기준만 잡는다. */
  onInventory(count: number): void;
  onHorn(): void;
  stop(): void;
};

export function createAudioDirector(audio: AudioSink): AudioDirector {
  const cfg = CONFIG.audio;
  let clock = 0;
  let self: { pos: Vec; floor: FloorId } = { pos: { x: 0, y: 0 }, floor: 0 };
  let lastNoiseAt = -Infinity;
  let lastBuzzAt = -Infinity;
  let heartbeatIn = 0;
  let inventory: number | null = null;
  const prevPos = new Map<string, Vec>();
  const stepIn = new Map<string, number>();
  const wasLit = new Map<string, boolean>();

  audio.setLoop('ambient', true);

  return {
    update(snap, dt) {
      clock += dt;
      self = { pos: snap.self.pos, floor: snap.self.floor };
      audio.setListener(self);

      let dragging = false;
      for (const m of snap.monsters) {
        const prev = prevPos.get(m.id);
        const moved = prev !== undefined && dist(prev, m.pos) > cfg.movedEpsilon;
        prevPos.set(m.id, { x: m.pos.x, y: m.pos.y });
        if (!m.active) continue;
        const at = { pos: m.pos, floor: m.floor };
        if (m.kind === 'stalker') {
          if (!moved) { stepIn.set(m.id, 0); continue; }
          const left = (stepIn.get(m.id) ?? 0) - dt;
          if (left <= 0) {
            audio.play('stalkerStep', at);
            stepIn.set(m.id, cfg.stalkerStepInterval);
          } else {
            stepIn.set(m.id, left);
          }
        } else if (m.moving && !m.frozen && m.floor === self.floor) {
          dragging = true;
          audio.setLoop('watcherDrag', true, at);
        }
      }
      if (!dragging) audio.setLoop('watcherDrag', false);

      for (const l of snap.lights) {
        const lit = isLightLit(l, snap.time);
        const before = wasLit.get(l.id) ?? lit;
        wasLit.set(l.id, lit);
        const blinking = l.on && (l.flickering || snap.time < l.flickerUntil);
        if (!blinking || !lit || before || l.floor !== self.floor) continue;
        if (dist(l.pos, self.pos) > cfg.buzzRange || clock - lastBuzzAt < cfg.buzzMinInterval) continue;
        lastBuzzAt = clock;
        audio.play('buzz', { pos: l.pos, floor: l.floor });
      }

      const danger = snap.self.alive ? dangerDistance(snap) : null;
      if (danger === null) {
        heartbeatIn = 0;
      } else {
        heartbeatIn -= dt;
        if (heartbeatIn <= 0) {
          audio.play('heartbeat');
          const closeness = 1 - Math.min(1, danger / CONFIG.fx.dangerDistance);
          heartbeatIn = cfg.heartbeatSlowInterval + (cfg.heartbeatFastInterval - cfg.heartbeatSlowInterval) * closeness;
        }
      }
    },
    onNoise(e) {
      if (e.radius !== CONFIG.noise.run) return;
      if (e.floor === self.floor && dist(e.pos, self.pos) < cfg.selfNoiseTolerance) return;
      if (clock - lastNoiseAt < cfg.teammateRunInterval) return;
      lastNoiseAt = clock;
      audio.play('teammateRun', { pos: e.pos, floor: e.floor });
    },
    onInventory(count) {
      if (inventory !== null && count > inventory) audio.play('pickup');
      inventory = count;
    },
    onHorn() {
      audio.play('horn');
    },
    stop() {
      audio.setLoop('watcherDrag', false);
      audio.setLoop('ambient', false);
    },
  };
}
