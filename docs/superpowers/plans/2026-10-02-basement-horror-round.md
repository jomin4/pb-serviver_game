# 지하주차장 협동 공포 게임 — 라운드 1회 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 친구 1~4명이 PC 브라우저에서 초대 링크로 모여 아파트 지하주차장에서 폐품을 트럭으로 나르는 협동 공포 라운드 1회를 처음부터 끝까지 플레이할 수 있게 만든다.

**Architecture:** npm workspaces 모노레포. `packages/shared`에 결정적 게임 규칙(`step(world, inputs, dt)`)을 순수 TypeScript로 두고, `packages/server`의 Colyseus 방이 이를 50ms마다 실행해 스키마 상태로 동기화한다. `packages/client`는 Vite + Canvas 2D로 그리고, 자기 캐릭터만 `shared` 이동 코드로 예측한다.

**Tech Stack:** Node 22, TypeScript 7, colyseus 0.18 / @colyseus/schema 5 / @colyseus/sdk 0.18 / @colyseus/testing 0.18, Vite 8, Vitest 5, @playwright/test 1.63, tsx.

**Spec:** `docs/superpowers/specs/2026-10-02-basement-horror-round-design.md` (이하 "스펙"). 각 태스크는 스펙의 해당 절을 함께 읽고 구현한다.

**테스트 표기:** 본문이 `{}`로 비어 있거나 주석만 있는 테스트는 이름이 곧 단언이다. 이름에 적힌 수치와 결과를 그대로 `expect`로 작성한다.

## Global Constraints

- ESM 전용(`"type": "module"`). 패키지 간 import는 `@bh/shared` 이름으로 한다. 상대 import는 `.ts` 확장자를 붙인다(`allowImportingTsExtensions`, `noEmit`).
- TypeScript `strict: true`. `any`는 Colyseus 콜백 시그니처 외에는 쓰지 않는다.
- `packages/shared`는 Node·DOM API를 import하지 않는다. `Math.random`과 `Date.now`를 쓰지 않는다(난수는 `rng`, 시간은 `dt`).
- 단위: 위치는 타일 단위 실수(1타일 = 32px), 속도는 타일/초, 시간은 초, 각도는 라디안(0 = +x, 시계 방향이 +, 캔버스 좌표계). 게임 시계는 "게임 분"(0~240).
- 조정 가능한 수치는 모두 `packages/shared/src/config.ts`의 `CONFIG`에만 둔다. 다른 파일에 매직 넘버를 두지 않는다.
- 서버 틱 50ms(20Hz), 상태 패치 50ms, 클라이언트 입력 전송 33ms(30Hz), 재접속 유예 20초, 정원 4명, 닉네임 1~10자(앞뒤 공백 제거 후).
- Colyseus 스키마는 `schema({...}, "Name")` + `t.*` 방식만 쓴다(데코레이터 금지).
- 화면 문구는 스펙의 한국어 문구를 그대로 쓴다.
- 포트: 서버 2567, Vite 개발 서버 5173.
- 모든 태스크 끝에 `npm test`(타입 검사 + Vitest)가 통과해야 커밋한다.

## Review Focus

1. **한글 입력 모드에서의 키 입력:** 한글 IME가 켜져 있으면 `KeyboardEvent.key`가 `ㅈ/ㅁ/ㄴ/ㅇ`이 되어 WASD가 먹지 않는다. 키 판정은 `event.code`(`KeyW`)로 해야 한다 → Task 17 테스트.
2. **창 포커스를 잃었을 때 눌린 키가 남는 문제:** Alt+Tab 등으로 `keyup`을 못 받으면 캐릭터가 계속 걷는다. `blur`에서 모든 키를 해제해야 한다 → Task 17 테스트.
3. **방 코드 입력 실수:** 소문자 입력(`k7m2qx`), 앞뒤 공백, 헷갈리는 문자(0/O, 1/I)는 정규화하거나 아예 생성하지 않아야 한다 → Task 13, 16 테스트.
4. **같은 닉네임 두 명:** 대기실과 퀵챗 기록에서 구분할 수 없게 된다. 중복이면 `철수(2)`처럼 접미사를 붙인다 → Task 13 테스트.
5. **라운드 중 탭 닫기(자발적 퇴장):** 재접속 유예 없이 즉시 사망 처리하고 소지품을 떨어뜨려야 한다. 그대로 두면 트럭 조기 출발 조건(생존자 전원 트럭 구역)이 영원히 충족되지 않는다 → Task 14 테스트.

---

## File Structure

```
package.json                     workspaces, 공통 스크립트
tsconfig.base.json               공통 컴파일 옵션
vitest.config.ts                 루트 Vitest 설정 (test.projects = packages/*)
.github/workflows/ci.yml         타입 검사 + 테스트 + 빌드
README.md                        실행 방법, 친구와 테스트하는 방법 (수정)

packages/shared/src/
  index.ts                       공개 export 모음
  config.ts                      CONFIG (모든 수치)
  rng.ts                         시드 난수
  types.ts                       World, PlayerState, ItemState, ... , PlayerInput, GameEvent
  geometry.ts                    Vec 연산, 각도, 선분 교차
  map/types.ts                   MapData, FloorData, TileKind
  map/grid.ts                    타일 조회, 이동 가능 판정, BFS 거리
  map/validate.ts                맵 검증
  map/parking-lot.json           지하주차장 맵 (B1, B2)
  map/index.ts                   맵 레지스트리 getMap(id)
  pathfinding.ts                 층 간 A*
  vision.ts                      벽 선분, 시선, 부채꼴, 가시 다각형
  movement.ts                    이동, 충돌, 스태미나, 끼임 해소
  input.ts                       입력 검증 sanitizeInput
  items.ts                       폐품 생성, 줍기, 버리기, 적재
  noise.ts                       소리 이벤트
  monsters/stalker.ts            추적형
  monsters/watcher.ts            시선형
  ghost.ts                       유령 이동, 깜빡이기
  comms.ts                       퀵챗, 핑
  round.ts                       createWorld, 난이도, 시계, 출발, 결과
  roomCode.ts                    방 코드 생성·정규화 (서버·클라이언트 공용)
  step.ts                        한 틱 처리
packages/shared/test/            모듈별 *.test.ts, scenario.test.ts, fuzz.test.ts

packages/server/src/
  schema.ts                      Colyseus 스키마 + syncSchema(world, state)
  lobby.ts                       닉네임 검증·중복 처리, 방장 계산
  RoundRoom.ts                   Colyseus 방
  app.ts                         defineServer (테스트와 실행이 공유)
  index.ts                       listen, 정적 파일 제공, 시작 시 맵 검증
packages/server/test/            lobby, room.lobby, room.game, index 테스트

packages/client/
  index.html
  vite.config.ts                 /colyseus 프록시 없음, 서버 주소는 env
  src/main.ts                    화면 전환(첫 화면→대기실→게임→결과)
  src/net/connection.ts          create/join/reconnect, 오류 코드 → 한국어 문구
  src/net/url.ts                 ?room= 파싱, 초대 링크 생성
  src/ui/screens.ts              첫 화면, 대기실, 결과, 오류 오버레이 DOM
  src/ui/hud.ts                  HUD DOM
  src/ui/menu.ts                 Esc 메뉴
  src/input/keyboard.ts          키·마우스 → PlayerInput
  src/input/sender.ts            30Hz 입력 묶음 전송
  src/sim/prediction.ts          예측 이동과 보정
  src/sim/interpolation.ts       100ms 지연 보간
  src/render/camera.ts           카메라·스케일
  src/render/drawTable.ts        엔티티 종류 → 그리기 함수
  src/render/mapLayer.ts         층별 오프스크린 맵
  src/render/lighting.ts         어둠·광원 레이어
  src/render/visibility.ts       visibleEntities (순수 함수)
  src/render/renderer.ts         프레임 합성, 효과
  src/audio/audio.ts             Web Audio, 합성음, 거리 감쇠
  src/audio/spatial.ts           gainAndPan (순수 함수)
packages/client/test/            url, connection, keyboard, sender, prediction, interpolation, visibility, spatial 테스트
e2e/round.spec.ts                Playwright E2E
playwright.config.ts
```

---

## 공유 타입 (Task 2에서 정의, 이후 모든 태스크가 사용)

```ts
// packages/shared/src/types.ts
export type Vec = { x: number; y: number };
export type FloorId = 0 | 1;                       // 0 = B1, 1 = B2
export type PlayerInput = {
  seq: number;
  move: Vec;                                       // 길이 ≤ 1
  run: boolean;
  aim: number;                                     // 라디안
  toggleFlashlight: boolean;                       // 이번 입력에서 눌림(엣지)
  interact: boolean;                               // 누르고 있는 상태(레벨)
  drop: boolean;                                   // 엣지
  selectSlot: 0 | 1 | 2 | null;
  ping: Vec | null;                                // 월드 좌표, 자기 층
  chat: 0 | 1 | 2 | 3 | 4 | 5 | null;
  flicker: boolean;                                // 유령 전용, 엣지
};
export type PlayerState = {
  id: string; name: string; pos: Vec; floor: FloorId; aim: number;
  flashlightOn: boolean; battery: number; hp: number; stamina: number;
  alive: boolean;                                  // false면 유령
  inventory: string[];                             // item id, 최대 3
  selectedSlot: 0 | 1 | 2; lastSeq: number; interactHeld: number; // 초
  prevInteract: boolean; onStairs: boolean; connected: boolean;
  cooldowns: { flicker: number; ping: number; chat: number };
  carriedTotal: number;                            // 결과 화면용 운반 누계
};
export type ItemState = { id: string; kind: string; value: number; weight: number;
  pos: Vec; floor: FloorId; carriedBy: string | null; loaded: boolean };
export type StalkerMode = 'patrol' | 'investigate' | 'chase' | 'search' | 'retreat';
export type StalkerState = { id: string; floor: FloorId; pos: Vec; mode: StalkerMode;
  targetId: string | null; goal: Vec | null; timer: number; patrolIndex: number;
  routeIndex: number; path: Vec[] };
export type WatcherState = { id: string; floor: FloorId; pos: Vec; active: boolean;
  frozen: boolean; moving: boolean; path: { floor: FloorId; pos: Vec }[]; waitTimer: number };
export type LightState = { id: string; floor: FloorId; pos: Vec; radius: number;
  on: boolean; flickering: boolean; flickerUntil: number };
export type RoundPhase = 'playing' | 'success' | 'fail';
export type RoundState = { clock: number; target: number; truckTotal: number;
  phase: RoundPhase; watcherSpawned: boolean; lightsHalved: boolean; horned: boolean };
export type GameEvent =
  | { type: 'chat'; playerId: string; index: number }
  | { type: 'ping'; playerId: string; floor: FloorId; pos: Vec }
  | { type: 'flicker'; lightIds: string[] }
  | { type: 'damage'; playerId: string }
  | { type: 'death'; playerId: string; cause: 'stalker' | 'watcher' | 'left_behind' | 'disconnect' }
  | { type: 'horn' }
  | { type: 'noise'; floor: FloorId; pos: Vec; radius: number }
  | { type: 'roundEnd'; phase: 'success' | 'fail' };
export type World = { tick: number; time: number; seed: number; rngState: number;
  mapId: string; playerCount: number; players: Record<string, PlayerState>;
  items: Record<string, ItemState>; stalkers: StalkerState[]; watcher: WatcherState;
  lights: LightState[]; round: RoundState; events: GameEvent[] };
```

`World`는 직렬화 가능한 순수 데이터다(클래스, 함수, Map 금지). `step`은 입력 world를 변경하지 않고 새 world를 돌려준다(구현은 `structuredClone` 후 변경해도 된다). `events`는 틱마다 비우고 새로 채운다.

---

### Task 1: 모노레포 뼈대, CONFIG, 난수

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/config.ts`, `packages/shared/src/rng.ts`
- Test: `packages/shared/test/rng.test.ts`, `packages/shared/test/config.test.ts`

**Interfaces:**
- Produces: `CONFIG` (아래 키), `createRng(seed: number): Rng`, `type Rng = { next(): number; int(min: number, max: number): number; state(): number }`, `rngFromState(state: number): Rng`
- Produces: 루트 스크립트 `"typecheck": "npm run typecheck --workspaces --if-present"`, `"test": "npm run typecheck && vitest run"`. 각 패키지는 `"typecheck": "tsc -p ."`를 갖는다(이후 태스크가 패키지를 추가하면 자동 포함). 루트 `vitest.config.ts`는 `defineConfig({ test: { projects: ['packages/*'] } })`(Vitest 5에는 `defineWorkspace`가 없다).

`CONFIG` 키와 값(스펙 2장 그대로):

```ts
tickMs: 50, patchMs: 50, inputSendMs: 33, reconnectSeconds: 20, maxPlayers: 4,
realSecondsPerGameMinute: 3, roundEndClock: 240, watcherSpawnClock: 30,
lightsHalfClock: 180, hornClock: 230,
player: { radius: 0.35, walkSpeed: 3, runSpeed: 5, staminaMax: 5, staminaRegen: 1,
  hp: 2, ambientRadius: 1.5, slots: 3, weightSlowPerKg: 0.01, weightSlowMax: 0.3,
  interactRange: 1.2, departHoldSeconds: 3 },
flashlight: { angle: Math.PI / 3, range: 8, batteryMax: 180 },
noise: { walk: 1.5, run: 8, drop: 6 },
items: { countAt4: 25, minCount: 10, valueMin: 10, valueMax: 80, weightMin: 2,
  weightMax: 15, totalFactor: 1.8 },
difficulty: { 1: { target: 150, stalkers: 1, stalkerSpeedMul: 0.85 },
  2: { target: 250, stalkers: 1, stalkerSpeedMul: 1 },
  3: { target: 350, stalkers: 2, stalkerSpeedMul: 1 },
  4: { target: 450, stalkers: 2, stalkerSpeedMul: 1 } },
stalker: { patrolSpeed: 2.5, investigateSpeed: 3.5, chaseSpeed: 4.5, sightRange: 6,
  loseSeconds: 5, searchSeconds: 5, retreatSeconds: 3, lateSpeedMul: 1.1, radius: 0.4 },
watcher: { speed: 5.5, radius: 0.4, waitSeconds: 1 },
ghost: { speed: 6, flickerRadius: 3, flickerSeconds: 1.5, flickerCooldown: 10 },
comms: { pingSeconds: 3, pingCooldown: 3, chatCooldown: 1,
  quickChats: ['여기로', '도와줘!', '폐품 있음', '도망쳐!', '비춰줘!', '트럭으로'] },
net: { maxMessagesPerSecond: 60, maxDt: 0.1, nicknameMax: 10, interpolationMs: 100 },
fx: { dangerDistance: 5 },
```

- [ ] **Step 1: 루트·shared 패키지 파일 작성** — 루트 `package.json`: `"private": true`, `"workspaces": ["packages/*"]`, devDependencies `typescript@^7`, `vitest@^5`, `tsx@^4`. 스크립트는 위 Interfaces 그대로. `.gitignore`: `node_modules`, `dist`, `test-results`, `playwright-report`.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// rng.test.ts
it('같은 시드는 같은 수열', () => {
  const a = createRng(42), b = createRng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
it('next는 [0,1)', () => { const r = createRng(1); for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); } });
it('int는 양끝 포함', () => { const r = createRng(7); const s = new Set<number>(); for (let i = 0; i < 2000; i++) s.add(r.int(1, 3)); expect([...s].sort()).toEqual([1, 2, 3]); });
it('state로 이어서 생성', () => { const a = createRng(9); a.next(); const b = rngFromState(a.state()); expect(b.next()).toBe(a.next()); });
// config.test.ts
it('인원별 난이도가 스펙 2.5와 일치', () => {
  expect(CONFIG.difficulty[1]).toEqual({ target: 150, stalkers: 1, stalkerSpeedMul: 0.85 });
  expect(CONFIG.difficulty[4]).toEqual({ target: 450, stalkers: 2, stalkerSpeedMul: 1 });
});
it('라운드 길이는 실제 12분', () => { expect(CONFIG.roundEndClock * CONFIG.realSecondsPerGameMinute).toBe(720); });
```

- [ ] **Step 3: `npm install && npx vitest run packages/shared` → FAIL(모듈 없음) 확인**
- [ ] **Step 4: `rng.ts`(mulberry32), `config.ts`(`as const`) 구현**
- [ ] **Step 5: CI 작성** — `.github/workflows/ci.yml`: push/pull_request에서 Node 22, `npm ci`, `npm test`, `npm run build --if-present`.
- [ ] **Step 6: `npm test` → PASS**
- [ ] **Step 7: Commit** `chore: scaffold monorepo with config and seeded rng`

---

### Task 2: 공유 타입, 기하, 맵 데이터와 검증

**Files:**
- Create: `packages/shared/src/types.ts`(위 "공유 타입" 그대로), `geometry.ts`, `map/types.ts`, `map/grid.ts`, `map/validate.ts`, `map/parking-lot.json`, `map/index.ts`
- Test: `packages/shared/test/geometry.test.ts`, `map.test.ts`

**Interfaces:**
- Produces (`map/types.ts`):

```ts
export type TileKind = 'wall' | 'floor' | 'pillar' | 'car' | 'stairs';
export type FloorData = { width: number; height: number; rows: string[] }; // '#'=wall '.'=floor 'P'=pillar 'C'=car 'S'=stairs
export type Rect = { x: number; y: number; w: number; h: number };          // 타일 단위
export type MapData = { id: string; floors: [FloorData, FloorData];
  truckZone: Rect;                                   // B1
  spawns: Vec[];                                     // B1, truckZone 안, 4개
  itemSlots: { floor: FloorId; pos: Vec }[];
  patrolRoutes: { floor: FloorId; points: Vec[] }[]; // 층마다 최소 1개
  lights: { id: string; floor: FloorId; pos: Vec; radius: number; flickering: boolean }[];
  stairs: { a: { floor: FloorId; tile: Vec }; b: { floor: FloorId; tile: Vec } }[];
  zones: { name: string; floor: FloorId; rect: Rect }[] };
```

- Produces (`map/grid.ts`): `tileAt(map, floor, tx, ty): TileKind`(범위 밖은 `'wall'`), `isSolid(kind): boolean`(wall·pillar·car), `isWalkableTile(map, floor, tx, ty): boolean`, `bfsDistances(map, floor, from: Vec): Int32Array`(도달 불가 = -1, 같은 층만), `stairsAt(map, floor, tile): { floor: FloorId; tile: Vec } | null`(연결된 반대편)
- Produces (`map/validate.ts`): `validateMap(map: MapData, itemCountNeeded: number): string[]`(오류 문구 목록, 빈 배열이면 통과)
- Produces (`map/index.ts`): `getMap(id: string): MapData`, `MAP_IDS = ['parking-lot']`
- Produces (`geometry.ts`): `add, sub, scale, len, dist, normalize(v): Vec`, `angleTo(from, to): number`, `angleDiff(a, b): number`(−π..π), `segmentsIntersect(p1, p2, q1, q2): boolean`, `tileCenter(t: Vec): Vec`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('angleDiff는 −π..π로 감싼다', () => { expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2); });
it('segmentsIntersect: 교차/평행', () => {
  expect(segmentsIntersect({x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0})).toBe(true);
  expect(segmentsIntersect({x:0,y:0},{x:2,y:0},{x:0,y:1},{x:2,y:1})).toBe(false);
});
it('parking-lot 맵은 검증을 통과', () => { expect(validateMap(getMap('parking-lot'), 25)).toEqual([]); });
it('벽 위의 폐품 칸은 거부', () => { const m = withItemSlotOnWall(getMap('parking-lot')); expect(validateMap(m, 25).join()).toMatch(/itemSlot/); });
it('트럭까지 못 가는 폐품 칸은 거부', () => { const m = withEnclosedItemSlot(getMap('parking-lot')); expect(validateMap(m, 25).join()).toMatch(/unreachable/); });
it('짝 없는 계단은 거부', () => { const m = withBrokenStairs(getMap('parking-lot')); expect(validateMap(m, 25).join()).toMatch(/stairs/); });
it('폐품 칸이 필요 개수보다 적으면 거부', () => { expect(validateMap(getMap('parking-lot'), 10_000).join()).toMatch(/itemSlots/); });
it('범위 밖은 벽', () => { expect(tileAt(getMap('parking-lot'), 0, -1, 0)).toBe('wall'); });
```

`withItemSlotOnWall` 등은 테스트 파일 안의 헬퍼로, `structuredClone`한 맵의 한 값을 바꾼다.

- [ ] **Step 2: `npx vitest run packages/shared/test/map.test.ts` → FAIL**
- [ ] **Step 3: 타입·기하·grid·validate 구현.** 검증 규칙은 스펙 5.5 + "spawns 4개가 모두 truckZone 안", "층마다 patrolRoute ≥ 1". 도달성은 B1 트럭 구역 칸에서 시작해 계단을 건너는 BFS로 판정한다.
- [ ] **Step 4: `parking-lot.json` 작성.** 층당 60×40. 스펙 2.1의 구역(주차 구역, 엘리베이터 홀·계단실, 보일러실, 전기실, 세대별 창고, 경비실, 분리수거장)을 `zones`에 이름과 함께 배치한다. B1 출입구에 트럭 구역(6×4 이상), 계단 2쌍, 폐품 칸 40개 이상(양층 분산, 창고·분리수거장에 밀집), 고정 조명은 B1 12개 이상·B2 6개 이하이고 그중 3개 이상 `flickering: true`, 순찰 경로는 층마다 1개(8지점 이상). 기둥은 4~6타일 간격 격자, 차량은 2×4 'C' 블록.
- [ ] **Step 5: 테스트 → PASS**
- [ ] **Step 6: Commit** `feat(shared): add core types, geometry and validated parking-lot map`

---

### Task 3: 층 간 A* 길찾기

**Files:**
- Create: `packages/shared/src/pathfinding.ts`
- Test: `packages/shared/test/pathfinding.test.ts`

**Interfaces:**
- Consumes: `isWalkableTile`, `stairsAt`, `MapData`
- Produces: `findPath(map, from: { floor: FloorId; pos: Vec }, to: { floor: FloorId; pos: Vec }): { floor: FloorId; pos: Vec }[] | null` — 타일 중심 좌표 목록(시작 칸 제외, 도착 칸 포함). 4방향 + 대각선(양옆이 모두 비어 있을 때만). 계단 칸에 들어서면 짝 계단 칸으로 순간 이동(비용 1). `pathLength(path): number`.

- [ ] **Step 1: 실패하는 테스트 작성** (테스트용 작은 맵을 `test/fixtures/tinyMap.ts`에 만든다: 10×6 두 층, 중간 벽, 계단 1쌍)

```ts
it('직선 경로', () => { const p = findPath(tiny, at(0,1,1), at(0,5,1))!; expect(p.at(-1)!.pos).toEqual({x:5.5,y:1.5}); expect(p.length).toBe(4); });
it('벽을 돌아간다', () => { const p = findPath(tiny, at(0,1,3), at(0,8,3))!; expect(p.every(n => isWalkableTile(tiny, n.floor, Math.floor(n.pos.x), Math.floor(n.pos.y)))).toBe(true); });
it('대각선은 모서리를 자르지 않는다', () => { /* 벽 모서리 옆 두 칸 사이 경로에 대각 이동 없음 */ });
it('계단으로 다른 층에 간다', () => { const p = findPath(tiny, at(0,1,1), at(1,8,4))!; expect(p.some(n => n.floor === 1)).toBe(true); });
it('경로가 없으면 null', () => { expect(findPath(tiny, at(0,1,1), at(0,9,0))).toBeNull(); /* (9,0)은 벽 */ });
```

- [ ] **Step 2: FAIL 확인** → **Step 3: 이진 힙 A* 구현**(휴리스틱: 같은 층 옥타일 거리, 다른 층은 가장 가까운 계단 경유 거리) → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add cross-floor A* pathfinding`

---

### Task 4: 시야 (벽 선분, 시선, 손전등 부채꼴, 가시 다각형)

**Files:**
- Create: `packages/shared/src/vision.ts`
- Test: `packages/shared/test/vision.test.ts`

**Interfaces:**
- Consumes: `tileAt`, `isSolid`, `segmentsIntersect`, `angleDiff`
- Produces:
  - `wallSegments(map, floor): Segment[]` — 단단한 칸의 외곽선만(인접한 단단한 칸 사이 변 제외), 같은 직선상 연속 변은 병합. 층별로 메모이즈. `type Segment = { a: Vec; b: Vec }`
  - `hasLineOfSight(map, floor, from: Vec, to: Vec): boolean`
  - `inFlashlight(map, floor, origin: Vec, aim: number, target: Vec): boolean` — `CONFIG.flashlight` 각도·사거리 + 시선
  - `visibilityPolygon(map, floor, origin: Vec, radius: number, arc?: { aim: number; angle: number }): Vec[]` — 각 선분 끝점 ±0.0001rad 방향으로 광선을 쏘아 가장 가까운 교차점을 각도순으로 정렬. `arc`가 있으면 부채꼴로 자르고 원점을 포함.

- [ ] **Step 1: 실패하는 테스트 작성** (tinyMap 사용)

```ts
it('벽 뒤는 시선이 막힌다', () => { expect(hasLineOfSight(tiny, 0, {x:1.5,y:3.5}, {x:8.5,y:3.5})).toBe(false); });
it('트인 곳은 보인다', () => { expect(hasLineOfSight(tiny, 0, {x:1.5,y:1.5}, {x:4.5,y:1.5})).toBe(true); });
it('부채꼴 밖(31°)은 안 보인다', () => { const t = polar({x:1.5,y:1.5}, 0.54, 3); expect(inFlashlight(tiny, 0, {x:1.5,y:1.5}, 0, t)).toBe(false); });
it('부채꼴 안(29°)은 보인다', () => { const t = polar({x:1.5,y:1.5}, 0.5, 3); expect(inFlashlight(tiny, 0, {x:1.5,y:1.5}, 0, t)).toBe(true); });
it('사거리 8 밖은 안 보인다', () => { expect(inFlashlight(open20, 0, {x:1.5,y:1.5}, 0, {x:9.6,y:1.5})).toBe(false); });
it('가시 다각형 꼭짓점은 반경 안이고 벽을 넘지 않는다', () => {
  const poly = visibilityPolygon(tiny, 0, {x:1.5,y:3.5}, 8);
  expect(poly.every(p => dist(p, {x:1.5,y:3.5}) <= 8 + 1e-6)).toBe(true);
  expect(poly.every(p => p.x <= 5 + 1e-6)).toBe(true); // x=5에 벽
});
it('wallSegments는 인접 벽 사이 변을 만들지 않는다', () => { expect(wallSegments(solid2x1, 0)).toHaveLength(4); });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add line of sight, flashlight cone and visibility polygon`

---

### Task 5: 이동과 충돌

**Files:**
- Create: `packages/shared/src/movement.ts`
- Test: `packages/shared/test/movement.test.ts`

**Interfaces:**
- Consumes: `isSolid`, `tileAt`, `CONFIG.player`
- Produces:
  - `moveCircle(map, floor, pos: Vec, delta: Vec, radius: number): Vec` — 축별로 분리해 이동하고, 원이 단단한 칸과 겹치면 그 축 이동을 칸 경계까지만 허용. `delta` 길이가 0.25를 넘으면 0.25 단위로 나눠 적용(벽 뚫림 방지).
  - `playerSpeed(p: PlayerState, items: Record<string, ItemState>, running: boolean): number` — 걷기 3/뛰기 5 × (1 − min(0.3, 총무게×0.01))
  - `applyPlayerMovement(map, p: PlayerState, input: PlayerInput, items, dt): PlayerState` — 스태미나 소모·회복(뛰기는 `move`가 0이 아니고 stamina > 0일 때만), 위치 갱신, 계단 칸 진입 시 짝 계단으로 이동(같은 계단에서 왕복을 반복하지 않도록, 도착한 뒤 계단 칸을 벗어날 때까지 `onStairs = true`로 재진입을 무시)
  - `unstick(map, floor, pos: Vec, radius): Vec` — 겹쳐 있으면 BFS로 가장 가까운 이동 가능 칸 중심으로
  - 클라이언트 예측(Task 17)도 `applyPlayerMovement`를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('벽을 통과하지 못한다', () => { const p = moveCircle(tiny, 0, {x:4.5,y:3.5}, {x:2,y:0}, 0.35); expect(p.x).toBeLessThanOrEqual(5 - 0.35 + 1e-9); });
it('큰 delta도 벽을 뚫지 않는다', () => { const p = moveCircle(tiny, 0, {x:4.5,y:3.5}, {x:10,y:0}, 0.35); expect(p.x).toBeLessThan(5); });
it('차량 칸도 막힌다', () => { /* 'C' 칸 방향 이동 */ });
it('뛰기가 걷기보다 빠르다', () => { expect(playerSpeed(p0, {}, true)).toBe(5); expect(playerSpeed(p0, {}, false)).toBe(3); });
it('무게 감속은 최대 30%', () => { expect(playerSpeed(carrying(10), items, false)).toBeCloseTo(2.7); expect(playerSpeed(carrying(45), items, false)).toBeCloseTo(2.1); });
it('스태미나 0이면 뛰지 못한다', () => { const p = applyPlayerMovement(open20, {...p0, stamina:0}, runRight, {}, 1); expect(p.pos.x - p0.pos.x).toBeCloseTo(3); });
it('뛰면 스태미나가 초당 1 줄고 멈추면 회복한다', () => { /* 1초 뛰기 → 4, 1초 정지 → 5 */ });
it('계단에 들어서면 짝 계단으로 이동하고 바로 되돌아가지 않는다', () => { /* 두 틱 연속 같은 계단 위 → floor 한 번만 바뀜 */ });
it('unstick은 벽 안의 점을 가장 가까운 빈 칸으로', () => { expect(isWalkableTile(tiny, 0, ...floorOf(unstick(tiny, 0, {x:5.5,y:3.5}, 0.35)))).toBe(true); });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add collision-aware player movement with stamina and weight`

---

### Task 6: 입력 검증

**Files:**
- Create: `packages/shared/src/input.ts`
- Test: `packages/shared/test/input.test.ts`

**Interfaces:**
- Produces: `sanitizeInput(raw: unknown): PlayerInput | null` — 객체가 아니거나 `seq`가 0 이상 정수가 아니면 `null`. 나머지는 범위로 자른다: `move` 길이 > 1이면 정규화, NaN/Infinity는 0, `aim`은 −π..π로 감쌈(NaN → 0), boolean이 아닌 플래그는 false, `selectSlot`은 0|1|2 외 null, `chat`은 0..5 정수 외 null, `ping`은 좌표가 유한하지 않으면 null. 알 수 없는 필드는 무시. `sanitizeBatch(raw: unknown): PlayerInput[]` — 배열이 아니면 [], 최대 10개까지만, 유효한 것만.
- Produces: `EMPTY_INPUT(seq: number): PlayerInput`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('문자열·null은 거부', () => { expect(sanitizeInput('x')).toBeNull(); expect(sanitizeInput(null)).toBeNull(); });
it('seq가 음수/소수면 거부', () => { expect(sanitizeInput({...ok, seq:-1})).toBeNull(); expect(sanitizeInput({...ok, seq:1.5})).toBeNull(); });
it('move 길이를 1로 제한', () => { expect(len(sanitizeInput({...ok, move:{x:10,y:0}})!.move)).toBeCloseTo(1); });
it('NaN 이동은 0', () => { expect(sanitizeInput({...ok, move:{x:NaN,y:1}})!.move).toEqual({x:0,y:1}); });
it('잘못된 chat/slot은 null', () => { const i = sanitizeInput({...ok, chat:9, selectSlot:5})!; expect(i.chat).toBeNull(); expect(i.selectSlot).toBeNull(); });
it('배치는 최대 10개', () => { expect(sanitizeBatch(Array(50).fill(ok))).toHaveLength(10); });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add input sanitization`

---

### Task 7: 폐품 생성, 줍기, 버리기, 적재

**Files:**
- Create: `packages/shared/src/items.ts`
- Test: `packages/shared/test/items.test.ts`

**Interfaces:**
- Consumes: `Rng`, `MapData`, `CONFIG.items`, `CONFIG.difficulty`
- Produces:
  - `itemCountFor(playerCount: 1|2|3|4): number` = `max(10, round(25 × target / 450))` → 1인 10, 2인 14, 3인 19, 4인 25. (스펙 2.4 "약 25개"를 인원별로 비례 축소한 해석. 4인 기준 25개.)
  - `spawnItems(map, rng, playerCount): Record<string, ItemState>` — 서로 다른 itemSlot에 배치, 값 10~80 정수, 무게 2~15 정수, 총액이 `1.8 × target`의 ±5% 안. 종류는 `ITEM_KINDS = ['고철', '구리 전선', '낡은 자전거', '폐가전', '녹슨 공구함']`에서 무작위.
  - `nearestPickable(world, playerId): string | null` — 같은 층, 바닥에 있고(`carriedBy === null && !loaded`), `interactRange` 안, 가장 가까운 것
  - `pickUp(world, playerId, itemId): void`(칸이 꽉 차면 아무것도 안 함), `dropSelected(world, playerId): string | null`(떨어뜨린 id), `dropAll(world, playerId): void`, `loadIntoTruck(world, playerId): number`(실은 총액, `carriedTotal`과 `round.truckTotal` 증가)
  - 이 함수들은 `step` 내부용으로 world를 직접 변경한다(호출자가 복제본을 넘긴다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it.each([1,2,3,4] as const)('%i인: 총액은 1.8×목표 ±5%, 값·무게 범위', (n) => {
  const items = Object.values(spawnItems(getMap('parking-lot'), createRng(3), n));
  const total = items.reduce((s, i) => s + i.value, 0), goal = 1.8 * CONFIG.difficulty[n].target;
  expect(items).toHaveLength(itemCountFor(n));
  expect(total).toBeGreaterThanOrEqual(goal * 0.95); expect(total).toBeLessThanOrEqual(goal * 1.05);
  expect(items.every(i => i.value >= 10 && i.value <= 80 && i.weight >= 2 && i.weight <= 15)).toBe(true);
  expect(new Set(items.map(i => `${i.floor}:${i.pos.x}:${i.pos.y}`)).size).toBe(items.length);
});
it('3칸이 차면 더 줍지 못한다', () => { /* 4번째 pickUp 후 inventory.length === 3, 그 아이템 carriedBy === null */ });
it('같은 틱에 두 명이 같은 폐품을 주우면 한 명만 갖는다', () => { /* pickUp(A), pickUp(B) 순 → A만 소유 */ });
it('dropAll은 소지품을 그 자리에 떨어뜨린다', () => { /* inventory=[], 각 item.pos == player.pos, carriedBy null */ });
it('loadIntoTruck은 총액과 개인 누계를 올리고 loaded 처리', () => { /* truckTotal += 합, carriedTotal += 합, inventory=[] */ });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현.** 총액 맞추기: 값을 무작위로 뽑고 `goal/합`으로 비율 조정 → 반올림·범위 자르기 → 남은 차이를 범위 안에서 1씩 조정.
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(shared): add scrap spawning, inventory and truck loading`

---

### Task 8: 라운드 생성, 시계, 트럭 출발, 결과

**Files:**
- Create: `packages/shared/src/round.ts`
- Test: `packages/shared/test/round.test.ts`

**Interfaces:**
- Consumes: `spawnItems`, `createRng`, `getMap`, `CONFIG`
- Produces:
  - `createWorld(params: { mapId: string; seed: number; players: { id: string; name: string }[] }): World` — 플레이어는 `spawns[i]`에서 시작(체력 2, 스태미나 5, 배터리 180, 손전등 꺼짐, aim 0). 추적형: 1~2인은 B2 순찰 경로 첫 지점에 1마리(`id: 'stalker-1'`), 3~4인은 층마다 1마리. 시선형 `{ id: 'watcher', active: false }`. 조명은 맵 `lights`에서 `on: true`. `round.target`은 난이도 표.
  - `advanceClock(world, dt): void` — `clock += dt / 3`. 30 도달 시 `spawnWatcher(world)` 호출 표시(`watcherSpawned`), 180 도달 시 켜진 조명 중 절반(내림)을 rng로 끔(`lightsHalved`), 230 도달 시 `horn` 이벤트(`horned`).
  - `spawnWatcher(world): void` — 살아 있는 플레이어들로부터 BFS 거리(층 간 포함)의 최솟값이 가장 큰 이동 가능 칸.
  - `inTruckZone(map, p: PlayerState): boolean`
  - `updateDepartHold(world, dt): boolean` — 살아 있는 플레이어가 1명 이상이고 전원 트럭 구역에 있을 때, 그중 `interact`를 누르고 있는 사람의 `interactHeld`가 3초 이상이면 true. 조건이 깨지면 해당 누적을 0으로.
  - `resolveDeparture(world): void` — 트럭 구역 밖 생존자 사망(`left_behind`, 소지품 낙하) 후 `phase = truckTotal >= target ? 'success' : 'fail'`, `roundEnd` 이벤트.
  - `checkAllDead(world): boolean` — 생존자 0명이면 `phase='fail'`, `truckTotal=0`, `roundEnd`.
  - `rechargeInTruck(world): void` — 트럭 구역 안 생존자 배터리 최대치.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('1인: 목표 150, 추적형 1마리는 B2', () => { const w = mk(1); expect(w.round.target).toBe(150); expect(w.stalkers.map(s => s.floor)).toEqual([1]); });
it('3인: 추적형 층마다 1마리', () => { expect(mk(3).stalkers.map(s => s.floor).sort()).toEqual([0, 1]); });
it('실제 90초 후 시선형 등장', () => { const w = mk(2); advanceClock(w, 90); expect(w.watcher.active).toBe(true); });
it('시선형은 플레이어에게서 가장 먼 칸에 등장', () => { /* 등장 칸의 최소 BFS 거리 ≥ 맵의 모든 이동 가능 칸 최소 거리 */ });
it('03:00에 켜진 조명의 절반이 꺼진다', () => { const w = mk(2); const on = w.lights.length; advanceClock(w, 540); expect(w.lights.filter(l => l.on).length).toBe(on - Math.floor(on / 2)); });
it('03:50에 경적은 한 번만', () => { const w = mk(2); advanceClock(w, 690); const n1 = w.events.filter(e => e.type === 'horn').length; w.events = []; advanceClock(w, 1); expect(n1).toBe(1); expect(w.events.some(e => e.type === 'horn')).toBe(false); });
it('조기 출발: 생존자 전원 트럭 구역 + 3초 누름', () => { /* 2.9초 false, 3.0초 true */ });
it('한 명이라도 밖에 있으면 조기 출발 불가', () => {});
it('04:00 출발 시 트럭 밖 생존자는 사망하고 소지품을 떨어뜨린다', () => {});
it('총액 ≥ 목표면 success, 아니면 fail', () => {});
it('전원 사망이면 fail이고 트럭 총액은 0', () => {});
it('트럭 구역에서 배터리 충전', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add round lifecycle, clock events and truck departure`

---

### Task 9: 소리와 추적형(옛 경비원)

**Files:**
- Create: `packages/shared/src/noise.ts`, `packages/shared/src/monsters/stalker.ts`
- Test: `packages/shared/test/stalker.test.ts`

**Interfaces:**
- Consumes: `findPath`, `hasLineOfSight`, `inFlashlight`, `moveCircle`, `CONFIG.stalker`, `CONFIG.noise`
- Produces:
  - `emitNoise(world, floor, pos, radius): void` — `noise` 이벤트 추가
  - `updateStalker(world, map, s: StalkerState, dt): void` — 스펙 2.6 표. 속도 = 상태별 속도 × 난이도 `stalkerSpeedMul` × (`lightsHalved`면 1.1). 발견 판정은 같은 층 생존자 중 (거리 ≤ 6이고 시선 있음) 또는 (그 플레이어의 손전등이 켜져 있고 `inFlashlight(..., p.aim, s.pos)`), 여러 명이면 가장 가까운 사람. 소리 감지는 이번 틱 `noise` 이벤트 중 같은 층·반경 안인 것(추격 중에는 무시). 경로는 목표가 1타일 이상 바뀌었을 때만 다시 계산.
  - `stalkerContacts(world, s): string[]` — 같은 층, 거리 < 플레이어 반경 + 0.4인 생존자 id
  - 공격 처리는 `step`에서: 접촉한 첫 플레이어 `hp -= 1`, `damage` 이벤트, 추적형 `mode='retreat'`, 3초간 플레이어 반대 방향으로 순찰 속도 이동 후 `search`.

- [ ] **Step 1: 실패하는 테스트 작성** (open20 맵, 플레이어 1명 직접 배치)

```ts
it('배회 중 소리를 들으면 조사로 전환하고 목표는 소리 위치', () => {});
it('반경 밖 소리는 무시', () => {});
it('6타일 안에서 보이면 추격', () => {});
it('6타일 안이어도 벽 뒤면 추격하지 않는다', () => {});
it('7타일 밖이라도 손전등에 비춰지면 그 플레이어를 추격', () => {});
it('추격 대상이 5초 시야 밖이면 수색, 수색 5초 후 배회', () => {});
it('추격 속도 4.5, 1인 보정 0.85, 03:00 이후 1.1배', () => { /* 1초 이동 거리 */ });
it('다른 층 플레이어는 발견하지 않는다', () => {});
it('후퇴 3초 후 수색', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add stalker state machine and noise`

---

### Task 10: 시선형(무궁화 귀신)

**Files:**
- Create: `packages/shared/src/monsters/watcher.ts`
- Test: `packages/shared/test/watcher.test.ts`

**Interfaces:**
- Consumes: `inFlashlight`, `findPath`, `pathLength`, `moveCircle`, `CONFIG.watcher`
- Produces:
  - `isWatcherLit(world, map): boolean` — 같은 층 생존자 중 손전등이 켜져 있고 `inFlashlight(map, floor, p.pos, p.aim, watcher.pos)`인 사람이 있으면 true. 유령은 제외.
  - `updateWatcher(world, map, dt): void` — 비활성이면 아무것도 안 함. `frozen = isWatcherLit`. 얼지 않았으면 경로 길이 기준 가장 가까운 생존자에게 5.5 속도로 경로를 따라 이동(계단 포함), `moving = true`. 경로가 없으면 1초 대기 후 재탐색. 경로는 0.5초마다 또는 목표 플레이어가 바뀌면 다시 계산.
  - `watcherContacts(world): string[]` — 같은 층, 거리 < 플레이어 반경 + 0.4인 생존자. `step`에서 즉사(`death` cause `watcher`) 처리.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('생존자가 비추면 정지', () => { /* 1초 update 후 위치 불변, frozen true */ });
it('유령이 비추는 것은 무효', () => { /* alive=false, flashlightOn=true → 이동함 */ });
it('손전등이 꺼져 있으면 무효', () => {});
it('벽 뒤에서 비추는 것은 무효', () => {});
it('비추지 않으면 가장 가까운 생존자에게 초당 5.5로 접근', () => {});
it('계단을 타고 다른 층 플레이어에게 간다', () => {});
it('경로가 없으면 1초 대기 후 재탐색', () => {});
it('소리 이벤트에 반응하지 않는다', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add watcher freeze-when-lit monster`

---

### Task 11: 유령, 퀵챗, 핑

**Files:**
- Create: `packages/shared/src/ghost.ts`, `packages/shared/src/comms.ts`
- Test: `packages/shared/test/ghost-comms.test.ts`

**Interfaces:**
- Produces:
  - `applyGhostMovement(map, p: PlayerState, input, dt): PlayerState` — 속도 6, 벽 무시, 맵 경계로만 제한, 계단 칸에서는 생존자와 같은 방식으로 층 이동
  - `tryFlicker(world, playerId): boolean` — 유령만, 쿨타임 0일 때, 같은 층 반경 3 안의 조명이 1개 이상이면 그 조명들의 `flickerUntil = time + 1.5`, `flicker` 이벤트, 쿨타임 10
  - `tryChat(world, playerId, index): boolean` — 쿨타임 1초, `chat` 이벤트
  - `tryPing(world, playerId, pos): boolean` — 쿨타임 3초, `ping` 이벤트(플레이어의 현재 층)
  - `tickCooldowns(p: PlayerState, dt): void`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('유령은 벽을 통과한다', () => {});
it('생존자는 깜빡이기를 쓸 수 없다', () => {});
it('깜빡이기 쿨타임 10초', () => { /* 성공 → 9.9초 후 실패 → 0.1초 후 성공 */ });
it('반경 3 안에 조명이 없으면 쿨타임을 소모하지 않는다', () => {});
it('퀵챗 쿨타임 1초, 핑 쿨타임 3초', () => {});
it('유령도 핑과 퀵챗을 쓸 수 있다', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(shared): add ghost actions, quick chat and ping`

---

### Task 12: `step` 통합, 시나리오, 무작위 반복 테스트

**Files:**
- Create: `packages/shared/src/step.ts`
- Modify: `packages/shared/src/index.ts`(모든 공개 함수·타입 export)
- Test: `packages/shared/test/step.test.ts`, `scenario.test.ts`, `fuzz.test.ts`

**Interfaces:**
- Consumes: Task 4~11의 모든 함수
- Produces: `step(world: World, inputs: Record<string, PlayerInput[]>, dt: number): World` — `dt`는 `min(dt, 0.1)`. `phase !== 'playing'`이면 world를 그대로 반환. 처리 순서(스펙 5.4):
  1. `events = []`, `time += dt`, `tick += 1`, 쿨타임 감소
  2. 플레이어별 입력을 seq 순으로 적용(이미 처리한 seq 이하는 버림, `lastSeq` 갱신): 칸 선택 → 손전등 토글(배터리 > 0일 때만) → 조준 → 이동(생존자 `applyPlayerMovement`, 유령 `applyGhostMovement`, 입력 하나당 `dt / 입력개수`) → 소음(뛰는 중이면 `run` 반경, 걷는 중이면 `walk`) → 버리기(`drop` 소음) → 퀵챗·핑·깜빡이기
  3. 상호작용(`interact` 엣지): 트럭 구역이면 적재, 아니면 가장 가까운 폐품 줍기. 플레이어 id 사전순으로 처리.
  4. 배터리 소모(켜져 있으면 초당 1, 0이 되면 꺼짐), 트럭 구역 충전
  5. 추적형 → 시선형 업데이트
  6. 피해와 사망: 추적형 접촉 → 피해, 시선형 접촉 → 즉사, 체력 0 → 사망. 사망 시 `dropAll`, `flashlightOn=false`, `death` 이벤트
  7. `checkAllDead` → 아니면 `updateDepartHold`가 true면 `resolveDeparture` → 아니면 `advanceClock`, 그 결과 clock ≥ 240이면 `resolveDeparture`
  8. 끼임 해소: 모든 생존자와 몬스터에 `unstick`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// step.test.ts
it('같은 시드·입력이면 결과가 같다', () => { expect(run(seed, script)).toEqual(run(seed, script)); });
it('이미 처리한 seq는 무시', () => {});
it('dt는 0.1로 제한', () => { /* dt=5 → time 증가 0.1 */ });
it('마지막 생존자가 죽는 틱에는 출발보다 실패가 우선', () => {});
it('playing이 아니면 아무것도 바뀌지 않는다', () => {});
// scenario.test.ts
it('B가 시선형을 비추는 동안 A가 폐품을 실으면 총액이 늘고 둘 다 생존', () => {});
it('뛰면 추적형이 조사하러 온다', () => {});
// fuzz.test.ts
it.each(range(100))('시드 %i: 무작위 입력으로 라운드 끝까지 예외 없음 + 불변 조건', (seed) => {
  // 매 틱: 생존자·몬스터가 단단한 칸과 겹치지 않음,
  // truckTotal === loaded 폐품 가치 합(실패 phase 제외),
  // 사망자 inventory 빈 배열, 각 item은 carriedBy와 inventory가 일치
  // 최대 15000틱 안에 phase !== 'playing'
});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: `npx vitest run packages/shared` → PASS**(fuzz는 10초 이내여야 함, 넘으면 시드 수 대신 틱당 비용을 줄인다)
- [ ] **Step 5: Commit** `feat(shared): add deterministic step with scenario and fuzz tests`

---

### Task 13: 서버 — 스키마, 방 코드, 대기실

**Files:**
- Create: `packages/shared/src/roomCode.ts`(클라이언트도 쓰므로 shared에 둔다)
- Create: `packages/server/package.json`(deps: `colyseus@^0.18`, `@colyseus/schema@^5`, `@bh/shared`; dev: `@colyseus/testing@^0.18`, `@colyseus/sdk@^0.18`), `tsconfig.json`, `src/schema.ts`, `src/lobby.ts`, `src/RoundRoom.ts`, `src/app.ts`, `src/version.ts`
- Test: `packages/shared/test/roomCode.test.ts`, `packages/server/test/lobby.test.ts`, `room.lobby.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `RoomState` 스키마 — `phase: 'lobby'|'playing'|'result'`, `hostId`, `mapId`, `seed`, `clock`, `target`, `truckTotal`, `result: ''|'success'|'fail'`, `players: map<PlayerS>`, `items: map<ItemS>`, `monsters: map<MonsterS>`(kind `'stalker'|'watcher'`, `mode`, `active`, `moving`, `frozen`), `lights: map<LightS>`. `PlayerS`는 `PlayerState`의 필드 + `colorIndex`, `isHost`, `joinOrder`. `syncSchema(world: World, state: RoomState): void` — world 값을 스키마로 복사하고, world에 없는 키는 삭제.
- Produces (`shared/src/roomCode.ts`, `shared/index.ts`에서 export): `CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'`, `generateRoomCode(random: () => number): string`(6자), `normalizeRoomCode(input: string): string | null`(공백 제거, 대문자화, 알파벳·길이 불일치면 null)
- Produces (`lobby.ts`): `validateNickname(raw: unknown): string | null`(trim 후 1~10자), `dedupeNickname(name: string, taken: string[]): string`(`철수` → `철수(2)` → `철수(3)`), `nextHost(players: { id: string; joinOrder: number }[]): string | null`
- Produces (`version.ts`): `GAME_VERSION: string` — 루트 `package.json`의 `version`을 `import pkg from '../../../package.json' with { type: 'json' }`로 읽는다. 클라이언트는 `vite.config.ts`의 `define: { __GAME_VERSION__: JSON.stringify(pkg.version) }`로 같은 값을 쓰고, 입장 옵션 `{ name, version }`으로 보낸다.
- Produces (`RoundRoom.ts`, 대기실 부분): `maxClients = 8`(정원 4는 `onAuth`에서 검사해 "locked"와 구분). `onCreate(options)`에서 `this.roomId = 코드`(충돌 시 `matchMaker.getRoomById`로 확인하고 재생성). `onAuth(client, options)`는 `ServerError`를 던진다: 버전 불일치 `4002 'VERSION_MISMATCH'`, `phase !== 'lobby'` → `4003 'IN_PROGRESS'`, 4명 → `4001 'ROOM_FULL'`, 닉네임 무효 → `4004 'BAD_NICKNAME'`. 메시지: `'start'`(방장만, 대기실에서만) → Task 14, `'again'`(결과 단계에서 아무나) → 모두 대기실로.
- Produces (`app.ts`): `export const server = defineServer({ rooms: { round: defineRoom(RoundRoom) } })`

검증된 API 메모: `boot(server)`로 테스트 서버를 띄우고 `colyseus.createRoom('round', opts)` / `colyseus.connectTo(room, opts)` / `colyseus.sdk.joinById(code, opts)`를 쓴다. 클라이언트가 하나도 없는 방은 입장 실패 직후 자동 삭제되므로, 거부 테스트는 정상 클라이언트를 먼저 붙인 뒤 한다. 상태 확인은 `await room.waitForNextPatch()` 후 50ms 대기.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// roomCode.test.ts
it('코드는 6자이고 0,O,1,I가 없다', () => { for (let i = 0; i < 500; i++) expect(generateRoomCode(Math.random)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); });
it('소문자·공백 정규화', () => { expect(normalizeRoomCode(' k7m2qx ')).toBe('K7M2QX'); });
it('헷갈리는 문자가 섞이면 null', () => { expect(normalizeRoomCode('K7M2Q0')).toBeNull(); });
// lobby.test.ts
it('닉네임 trim 후 1~10자', () => { expect(validateNickname('  철수 ')).toBe('철수'); expect(validateNickname('')).toBeNull(); expect(validateNickname('가'.repeat(11))).toBeNull(); });
it('중복 닉네임에 접미사', () => { expect(dedupeNickname('철수', ['철수', '철수(2)'])).toBe('철수(3)'); });
it('방장은 가장 먼저 들어온 사람', () => { expect(nextHost([{id:'b',joinOrder:2},{id:'a',joinOrder:1}])).toBe('a'); });
// room.lobby.test.ts
it('방을 만들면 roomId가 6자리 코드이고 만든 사람이 방장', async () => {});
it('초대 코드로 입장하면 같은 방 목록에 보인다', async () => {});
it('5번째 입장은 4001 ROOM_FULL', async () => {});
it('진행 중 입장은 4003 IN_PROGRESS', async () => {});
it('버전이 다르면 4002 VERSION_MISMATCH', async () => {});
it('방장이 나가면 다음 사람이 방장', async () => {});
it('방장 아닌 사람의 start는 무시', async () => {});
it('같은 닉네임은 철수(2)로 표시', async () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(server): add room codes, lobby flow and join errors`

---

### Task 14: 서버 — 게임 루프, 입력, 재접속, 오류 격리

**Files:**
- Modify: `packages/server/src/RoundRoom.ts`
- Test: `packages/server/test/room.game.test.ts`

**Interfaces:**
- Consumes: `createWorld`, `step`, `sanitizeBatch`, `syncSchema`, `CONFIG`
- Produces:
  - `'start'` 처리: `seed`는 서버 `crypto.randomInt`, `world = createWorld({ mapId: 'parking-lot', seed, players })`, `phase='playing'`, `setSimulationInterval(tick, 50)`, `setPatchRate(50)`
  - `'input'` 메시지: `sanitizeBatch` 결과를 플레이어 큐에 추가. 클라이언트별 1초 창에서 60개 초과 메시지는 버림.
  - `tick(deltaMs)`: `world = step(world, queues, deltaMs / 1000)` → 큐 비움 → `syncSchema` → `world.events`를 `broadcast('event', e)` → `phase`가 끝나면 `state.phase='result'`, `state.result` 설정, 시뮬레이션 정지
  - 예외: `tick` 안의 오류는 잡아서 `console.error({ roomId, tick, seed, err })`, `broadcast('roundError', { message: '오류로 라운드가 종료되었습니다' })`, 대기실로 복귀. 프로세스는 계속 실행.
  - `onDrop(client)`: 대기실·결과 단계면 바로 제거. 진행 중이면 `connected=false`로 표시하고 `await this.allowReconnection(client, 20)`; 성공 시 `connected=true`, 실패(예외) 시 `world`의 해당 플레이어 사망(`disconnect`) + `dropAll`.
  - `onLeave(client)`(자발적 퇴장 포함): 진행 중이면 즉시 사망 + `dropAll`(Review Focus 5). 방장이면 `nextHost`.
  - `'again'`: `phase='lobby'`, world 폐기, 같은 멤버 유지.
  - 서버 로그: 방 생성·시작·종료를 `{ roomId, seed, players, result }`와 함께 `console.info`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('시작하면 playing이 되고 시계가 흐른다', async () => {});
it('input 메시지로 캐릭터가 움직이고 lastSeq가 갱신된다', async () => {});
it('잘못된 형식의 input을 보내도 서버가 계속 동작한다', async () => { /* send('input', 'garbage') 후 다른 클라이언트 입력이 정상 반영 */ });
it('1초에 61번째 메시지부터는 버린다', async () => {});
it('20초 안에 재접속하면 같은 캐릭터로 복귀', async () => { /* sdk.reconnect(token) → 같은 sessionId, alive true */ });
it('재접속하지 않으면 20초 후 사망 처리', async () => { /* vi.useFakeTimers 대신 CONFIG를 테스트에서 덮어쓸 수 있게 RoundRoom 옵션 reconnectSeconds 허용 */ });
it('진행 중 자발적으로 나가면 즉시 사망하고 소지품이 떨어진다', async () => {});
it('규칙 실행 중 예외가 나면 roundError를 보내고 대기실로 돌아간다', async () => { /* RoundRoom 옵션 stepFn 주입으로 throw */ });
it('again이면 같은 멤버로 대기실', async () => {});
```

`RoundRoom`은 테스트용 기본 옵션 `{ reconnectSeconds?: number; stepFn?: typeof step }`을 받는다(기본값은 CONFIG와 실제 `step`). 클라이언트가 보낸 생성 옵션의 같은 키는 무시한다. 테스트 파일은 `boot(defineServer({ rooms: { round: defineRoom(RoundRoom, { reconnectSeconds: 1 }) } }))`처럼 자체 서버 정의를 만든다.

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(server): run authoritative game loop with reconnection and error isolation`

---

### Task 15: 서버 실행 진입점과 정적 파일 제공

**Files:**
- Create: `packages/server/src/index.ts`
- Modify: `packages/server/package.json` 스크립트 `"dev": "tsx watch src/index.ts"`, `"start": "tsx src/index.ts"`
- Modify: 루트 `package.json` 스크립트 `"dev"`(서버와 클라이언트 동시 실행, `npm run dev -w @bh/server & npm run dev -w @bh/client`), `"build"`(클라이언트 빌드), `"serve"`(빌드 후 서버가 `packages/client/dist` 제공)
- Test: `packages/server/test/index.test.ts`

**Interfaces:**
- Produces: `startServer(opts: { port: number; staticDir?: string }): Promise<{ close(): Promise<void> }>` — 시작 전 `MAP_IDS` 전부 `validateMap` 검사, 오류가 있으면 오류 목록과 함께 throw. `defineServer`의 `express: (app) => app.use(express.static(staticDir))`로 빌드된 클라이언트 제공(`staticDir`이 있을 때만). `GET /healthz` → `{ ok: true, version }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('healthz는 버전을 돌려준다', async () => { const s = await startServer({ port: 0 }); /* fetch → ok true */ await s.close(); });
it('staticDir의 index.html을 제공한다', async () => {});
it('맵 검증 실패 시 시작하지 않는다', async () => { /* getMap을 vi.mock으로 깨진 맵 반환 → rejects */ });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(server): add entry point serving client build and health check`

---

### Task 16: 클라이언트 — 연결, 첫 화면, 대기실, 결과 화면

**Files:**
- Create: `packages/client/package.json`(deps: `@colyseus/sdk@^0.18`, `@bh/shared`; dev: `vite@^8`), `index.html`, `vite.config.ts`, `src/main.ts`, `src/net/connection.ts`, `src/net/url.ts`, `src/ui/screens.ts`, `src/styles.css`
- Test: `packages/client/test/url.test.ts`, `connection.test.ts`

**Interfaces:**
- Produces (`url.ts`): `roomFromUrl(href: string): string | null`(`?room=` 값을 `@bh/shared`의 `normalizeRoomCode`로 정규화), `inviteLink(origin: string, code: string): string`
- Produces (`connection.ts`): `serverUrl(): string`(`import.meta.env.VITE_SERVER_URL` 또는 `location` 기반 `ws(s)://host`), `joinErrorMessage(err: unknown): string` — 코드별 문구: 연결 실패(코드 없음) → `'서버에 연결할 수 없습니다'`, `'not found'` 포함 → `'방을 찾을 수 없습니다. 코드를 확인해 주세요'`, 4001 → `'방이 가득 찼습니다'`, 4003 → `'게임이 진행 중입니다. 끝나면 다시 시도해 주세요'`, 4002 → `'새 버전이 있습니다. 새로고침해 주세요'`, 4004 → `'닉네임은 1~10자로 입력해 주세요'`. `createRoom(name)`, `joinRoom(code, name)`, `reconnect(token)` — `@colyseus/sdk`의 `Client`(`create`, `joinById`, `reconnect`) 래퍼. 재접속 토큰은 `sessionStorage`에 저장.
- Produces (`screens.ts`): `showHome(onCreate, onJoin)`, `showLobby(state, isHost, onStart, link)`, `showResult(state, onAgain)`, `showError(message, onRetry?)`, `showReconnecting(secondsLeft)` — DOM만 다루고 상태를 갖지 않는다. 결과 화면은 스펙 2.8 결과 항목을 표로 보여준다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('?room= 코드를 정규화해서 읽는다', () => { expect(roomFromUrl('https://x.test/?room=k7m2qx')).toBe('K7M2QX'); });
it('잘못된 코드는 null', () => { expect(roomFromUrl('https://x.test/?room=zz')).toBeNull(); });
it('초대 링크 형식', () => { expect(inviteLink('https://x.test', 'K7M2QX')).toBe('https://x.test/?room=K7M2QX'); });
it.each([[{ code: 4001 }, '방이 가득 찼습니다'], [{ code: 4003 }, '게임이 진행 중입니다. 끝나면 다시 시도해 주세요'], [{ code: 4002 }, '새 버전이 있습니다. 새로고침해 주세요'], [new Error('room "X" not found'), '방을 찾을 수 없습니다. 코드를 확인해 주세요'], [new TypeError('fetch failed'), '서버에 연결할 수 없습니다']])('오류 문구 %#', (e, msg) => { expect(joinErrorMessage(e)).toBe(msg); });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현.** 대기실에서 "링크 복사"는 `navigator.clipboard.writeText`, 실패하면 링크 텍스트를 선택 상태로 둔다. 닉네임 입력창 아래에 즉시 검증 문구.
- [ ] **Step 4: PASS + 수동 확인** — `npm run dev` 후 브라우저 2개로 방 만들기 → 링크 입장 → 대기실 목록 확인
- [ ] **Step 5: Commit** `feat(client): add connection, home, lobby and result screens`

---

### Task 17: 클라이언트 — 입력, 예측, 보간

**Files:**
- Create: `packages/client/src/input/keyboard.ts`, `src/input/sender.ts`, `src/sim/prediction.ts`, `src/sim/interpolation.ts`
- Test: `packages/client/test/keyboard.test.ts`, `sender.test.ts`, `prediction.test.ts`, `interpolation.test.ts`

**Interfaces:**
- Produces (`keyboard.ts`): `createInputState(): InputState`, `onKeyDown(s, code: string)`, `onKeyUp(s, code)`, `onBlur(s)`, `onMouseMove(s, worldPos: Vec, playerPos: Vec)`, `onMouseDown(s, button)`, `onWheel(s, deltaY)`, `sampleInput(s, seq: number): PlayerInput`(엣지 플래그는 샘플 후 초기화). 키 매핑은 스펙 4.6, **`KeyboardEvent.code` 기준**(`KeyW`, `ShiftLeft`, `Digit1`…). T를 누른 상태에서 Digit1~6은 퀵챗, 아니면 Digit1~3은 칸 선택.
- Produces (`sender.ts`): `createSender(send: (batch: PlayerInput[]) => void, intervalMs = 33)` → `{ push(input), flush(), start(), stop() }` — 33ms마다 쌓인 입력을 한 번에 전송, 엣지 플래그가 있는 입력은 버리지 않는다.
- Produces (`prediction.ts`): `createPredictor(map)` → `{ apply(input, self: PlayerState, items, dt): PlayerState; reconcile(server: PlayerState, items): PlayerState }` — 보낸 입력을 보관하고, 서버 `lastSeq` 이하는 버린 뒤 나머지를 `applyPlayerMovement`로 다시 적용
- Produces (`interpolation.ts`): `createInterpolator(delayMs = 100)` → `{ push(timeMs, snapshot: Record<string, { pos: Vec; floor: FloorId }>); sample(nowMs): Record<string, { pos: Vec; floor: FloorId }> }` — 층이 바뀐 엔티티와 1초 이상 간격은 보간 없이 최신 값(탭 복귀 처리)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('한글 입력 모드에서도 code 기준으로 이동한다', () => { const s = createInputState(); onKeyDown(s, 'KeyW'); expect(sampleInput(s, 1).move).toEqual({ x: 0, y: -1 }); });
it('blur 시 눌린 키가 모두 해제된다', () => { const s = createInputState(); onKeyDown(s, 'KeyD'); onKeyDown(s, 'ShiftLeft'); onBlur(s); const i = sampleInput(s, 1); expect(i.move).toEqual({ x: 0, y: 0 }); expect(i.run).toBe(false); });
it('대각선 이동은 길이 1', () => {});
it('T+3은 퀵챗 2, 3만 누르면 칸 2', () => {});
it('토글 엣지는 한 번만 전달된다', () => { /* F 다운 → sample true → 다음 sample false */ });
it('sender는 33ms마다 묶어서 보낸다', () => { /* vi.useFakeTimers, push 3번 → advance 33 → send 1회, 길이 3 */ });
it('reconcile은 서버 위치에서 미처리 입력을 다시 적용한다', () => {});
it('보간은 100ms 전 두 스냅숏 사이 값', () => {});
it('층이 바뀌면 보간하지 않는다', () => {});
it('1초 이상 간격이면 최신 값으로 즉시 이동', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS** → **Step 5: Commit** `feat(client): add code-based input, batching, prediction and interpolation`

---

### Task 18: 클라이언트 — 렌더링, 조명, HUD

**Files:**
- Create: `packages/client/src/render/camera.ts`, `drawTable.ts`, `mapLayer.ts`, `lighting.ts`, `visibility.ts`, `renderer.ts`, `src/ui/hud.ts`
- Modify: `src/main.ts`(게임 화면 연결: 상태 → 렌더 스냅숏 → 매 프레임 `renderer.draw`)
- Test: `packages/client/test/visibility.test.ts`, `camera.test.ts`

**Interfaces:**
- Consumes: `visibilityPolygon`, `wallSegments`, `CONFIG`, Task 17 보간·예측 결과
- Produces:
  - `type RenderSnapshot = { selfId: string; self: PlayerState; players: PlayerState[]; items: ItemState[]; monsters: { id: string; kind: 'stalker' | 'watcher'; pos: Vec; floor: FloorId; active: boolean }[]; lights: LightState[]; time: number; pings: { pos: Vec; floor: FloorId; until: number }[] }`
  - `lightSources(snap): { pos: Vec; radius: number; arc?: { aim: number; angle: number } }[]` — 자기 층의 생존자 주변 빛(1.5), 켜진 손전등, 켜진 고정 조명(깜빡이는 중이면 `Math.floor(time*12) % 2`일 때만), 트럭 구역 빛
  - `visibleEntities(snap, map): { items: ItemState[]; monsters: ...[]; players: PlayerState[] }` — 생존자 시점: 같은 층이고 어떤 광원 다각형 안에 있는 몬스터·폐품만, 유령은 숨김(유령끼리는 보임). 유령 시점: 같은 층의 모든 몬스터·폐품·플레이어.
  - `createCamera(viewW = 960, viewH = 540)` → `{ resize(cssW, cssH, dpr); follow(pos: Vec); worldToScreen(v: Vec): Vec; screenToWorld(v: Vec): Vec }` — 비율 유지, `devicePixelRatio` 반영
  - `DRAW_TABLE: Record<'player' | 'ghost' | 'stalker' | 'watcher' | 'item' | 'truck', (ctx, e, cam) => void>` — 스펙 4.2의 도형
  - `renderer.draw(snap)` — 순서: 맵(층별 오프스크린 캐시) → 폐품 → 캐릭터 → 어둠(생존자 알파 0.95, 유령 0.6; `destination-out`으로 광원 다각형을 방사형 그라데이션으로 뚫음) → 효과(핑, 화면 밖 핑 화살표, 위험 비네트: 같은 층 활성 몬스터 ≤ 5타일, 체력 1 붉은 가장자리, 피격 흔들림 0.3초)
  - `hud.update(snap, state)` — 스펙 4.5 항목. 시계는 `HH:MM`(clock 분을 0~4시로).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('생존자에게는 빛 밖의 몬스터가 보이지 않는다', () => {});
it('손전등 부채꼴 안의 몬스터는 보인다', () => {});
it('다른 층 엔티티는 보이지 않는다', () => {});
it('생존자에게 유령은 보이지 않고 유령끼리는 보인다', () => {});
it('유령 시점에서는 어둠 속 몬스터도 보인다', () => {});
it('카메라: 1920×1080 창에서 960×540은 2배, 좌표 왕복 변환이 일치', () => {});
```

- [ ] **Step 2: FAIL** → **Step 3: 구현** → **Step 4: PASS**
- [ ] **Step 5: 화면 확인** — `npm run dev`, Playwright 스크립트(Task 20의 헬퍼 재사용 전이면 수동)로 1인 시작 후 손전등 켜고 스크린샷. 확인 항목: 어둠과 부채꼴이 벽에서 잘림, HUD 표시, 60fps(`performance` 패널에서 프레임 시간 < 16ms)
- [ ] **Step 6: Commit** `feat(client): render map, entities, lighting and HUD`

---

### Task 19: 클라이언트 — 소리와 Esc 메뉴

**Files:**
- Create: `packages/client/src/audio/spatial.ts`, `src/audio/audio.ts`, `src/ui/menu.ts`
- Test: `packages/client/test/spatial.test.ts`, `menu.test.ts`

**Interfaces:**
- Produces (`spatial.ts`): `gainAndPan(listener: { pos: Vec; floor: FloorId }, source: { pos: Vec; floor: FloorId }, maxDistance: number): { gain: number; pan: number }` — 다른 층이면 gain 0, 거리 0 → 1, maxDistance 이상 → 0(선형), pan = clamp(dx / maxDistance, −1, 1)
- Produces (`audio.ts`): `createAudio()` → `{ unlock(); play(kind, at?: { pos; floor }); setListener(...); setVolume(v: number); setEnabled(b: boolean) }`. `kind`: `'stalkerStep' | 'watcherDrag' | 'teammateRun' | 'pickup' | 'buzz' | 'horn' | 'heartbeat' | 'ambient'`. 소리는 Web Audio 오실레이터·노이즈로 합성한다(파일 로딩 없음 → 로딩 실패 경로 없음). 추적형 발소리는 추격·조사·배회 중 이동할 때 0.5초 간격, 시선형은 `moving && !frozen`일 때 연속.
- Produces (`menu.ts`): `loadSettings(): { enabled: boolean; volume: number }`(`localStorage` 키 `bh.settings`, 읽기 실패·파싱 실패 시 `{ enabled: true, volume: 0.8 }`), `saveSettings(s)`(실패해도 예외를 던지지 않음), `showMenu(onLeave)` — Esc로 열고 닫음

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('다른 층 소리는 0', () => { expect(gainAndPan(l(0,0,0), l(1,1,0), 10).gain).toBe(0); });
it('거리에 따라 선형 감쇠, 오른쪽은 +pan', () => { const r = gainAndPan(l(0,0,0), l(0,5,0), 10); expect(r.gain).toBeCloseTo(0.5); expect(r.pan).toBeCloseTo(0.5); });
it('localStorage가 throw해도 기본 설정', () => { /* getItem이 throw하는 stub → { enabled: true, volume: 0.8 } */ });
```

- [ ] **Step 2: FAIL** → **Step 3: 구현.** 첫 클릭(시작 버튼)에서 `unlock()`.
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(client): add spatial synthesized audio and settings menu`

---

### Task 20: E2E 테스트와 실행 문서

**Files:**
- Create: `playwright.config.ts`, `e2e/round.spec.ts`
- Modify: 루트 `package.json`(dev `@playwright/test@^1.63`, 스크립트 `"e2e": "playwright test"`), `README.md`

**Interfaces:**
- Consumes: 전체 앱
- Produces: `playwright.config.ts` — `webServer`로 `npm run serve`(포트 2567) 실행, `use.baseURL = 'http://localhost:2567'`, `launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH`(설정되지 않으면 Playwright 기본 브라우저). 클라우드 세션에서는 `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

- [ ] **Step 1: 실패하는 E2E 작성**

```ts
test('두 명이 링크로 모여 라운드를 시작하고 움직인다', async ({ browser }) => {
  // A: 닉네임 '가' → 방 만들기 → 초대 링크 읽기
  // B: 초대 링크 열기 → 닉네임 '나' → 대기실에 '가','나' 둘 다 보임
  // A: 시작 → 두 화면 모두 HUD 시계 '00:00' 근처
  // A: KeyD 1초 누름 → B 화면의 state에서 A의 x 증가 (window.__bhDebug 노출: selfId, state 스냅숏)
  // 스크린샷: test-results/lobby.png, test-results/game-a.png
});
test('없는 방 코드는 안내 문구', async ({ page }) => { /* /?room=ABCDEF → '방을 찾을 수 없습니다. 코드를 확인해 주세요' */ });
```

`window.__bhDebug`는 `import.meta.env.DEV` 또는 `?debug=1`일 때만 노출한다.

- [ ] **Step 2: `npm run e2e` → FAIL 확인** → **Step 3: 부족한 부분 보완(디버그 훅, 선택자용 `data-testid`)** → **Step 4: `npm run e2e` → PASS, 스크린샷 생성 확인**
- [ ] **Step 5: README 작성** — 설치(`npm install`), 개발(`npm run dev` → http://localhost:5173), 테스트(`npm test`, `npm run e2e`), 친구와 하기(`npm run serve` 후 `cloudflared tunnel --url http://localhost:2567`, 표시된 https 주소에 `?room=코드`로 공유), 조작키 표(스펙 4.6), 직접 플레이 체크리스트(스펙 6.5)
- [ ] **Step 6: 전체 확인** — `npm test && npm run e2e` 모두 PASS
- [ ] **Step 7: Commit** `test: add two-player e2e and document how to play with friends`

---

## 스펙 대비 점검

| 스펙 절 | 태스크 |
|---|---|
| 1 구조, 1.3 원칙 | 1, 2, 12 |
| 2.1 맵 | 2 |
| 2.2 시간 | 8 |
| 2.3 플레이어 | 5, 12 |
| 2.4 폐품 | 7 |
| 2.5 난이도 | 1, 8 |
| 2.6 추적형 | 9, 12 |
| 2.7 시선형 | 10, 12 |
| 2.8 트럭·종료 | 8, 12 |
| 2.9 유령, 2.10 소통 | 11 |
| 3.1 입장 흐름 | 13, 16 |
| 3.2 데이터 흐름 | 13, 14, 17 |
| 3.3 지연 처리 | 17 |
| 3.4 연결 끊김 | 14, 16 |
| 3.5 실행 | 15, 20 |
| 3.6 최소 방어 | 6, 13, 14 |
| 4.1~4.3 화면·조명 | 18 |
| 4.4 소리 | 19 |
| 4.5 HUD | 18 |
| 4.6 조작 | 17 |
| 5 오류 처리 | 2(5.5), 12(5.4), 13~16(5.1~5.3), 19(5.6), 14(5.7) |
| 6 테스트 | 각 태스크, 12(시나리오·fuzz), 20(E2E), 1(CI) |
