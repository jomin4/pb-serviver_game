export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  state(): number;
};

// mulberry32: 32비트 상태 하나로 동작하는 시드 가능한 난수 생성기.
export function rngFromState(state: number): Rng {
  let a = state >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    state: () => a,
  };
}

export function createRng(seed: number): Rng {
  return rngFromState(seed);
}
