import { applyPlayerMovement, CONFIG } from '@bh/shared';
import type { ItemState, MapData, PlayerInput, PlayerState } from '@bh/shared';

export type Predictor = {
  /** 입력을 즉시 적용한 내 상태를 돌려주고, 보정을 위해 (입력, dt)를 보관한다. */
  apply(input: PlayerInput, self: PlayerState, items: Record<string, ItemState>, dt: number): PlayerState;
  /** 서버 상태에서 아직 처리되지 않은 입력을 다시 적용한 상태를 돌려준다. */
  reconcile(server: PlayerState, items: Record<string, ItemState>): PlayerState;
  /** 서버가 아직 확인하지 않은 입력 수. */
  pendingCount(): number;
};

type Pending = { input: PlayerInput; dt: number };

/**
 * 내 캐릭터 예측 이동(스펙 3.3). 서버는 한 틱의 dt를 그 틱에 받은 입력 수로 나누므로 클라이언트가
 * 서버의 dt를 그대로 따라 할 수는 없다. 대신 각 입력을 만들 때 쓴 dt를 함께 보관했다가 같은 dt로 다시 적용한다.
 * dt는 서버와 같은 상한(`CONFIG.net.maxDt`)으로 제한한다.
 *
 * 유령(`alive === false`)은 예측하지 않는다. 유령 이동(`applyGhostMovement`)은 서버 상태를 그대로 쓰고,
 * 대기열도 만들지 않는다(보정할 예측이 없으므로).
 */
export function createPredictor(map: MapData): Predictor {
  let pending: Pending[] = [];

  return {
    apply(input, self, items, dt) {
      if (!self.alive) return self;
      const step = Math.max(0, Math.min(dt, CONFIG.net.maxDt));
      pending.push({ input, dt: step });
      return applyPlayerMovement(map, self, input, items, step);
    },
    reconcile(server, items) {
      if (!server.alive) {
        pending = [];
        return server;
      }
      pending = pending.filter((p) => p.input.seq > server.lastSeq);
      let state = server;
      for (const p of pending) state = applyPlayerMovement(map, state, p.input, items, p.dt);
      return state;
    },
    pendingCount: () => pending.length,
  };
}
