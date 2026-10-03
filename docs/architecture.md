# 아키텍처

하위 프로젝트 1(라운드 1회) 기준 구조. 규칙은 `@bh/shared`에만 있고, 서버는 그것을 실행하며,
클라이언트는 예측 이동과 시야 계산에만 같은 코드를 쓴다(스펙 2장, 3.3).

## 1. 전체 구조

```mermaid
flowchart LR
  subgraph B["브라우저 · packages/client"]
    C["Vite + Canvas<br/>화면 · 입력 · 예측 · 조명 · 소리"]
  end
  subgraph S["Node 서버 · packages/server :2567"]
    R["RoundRoom<br/>대기실 · 20Hz 틱 · 입력 큐 · 재접속"]
    A["app.ts<br/>express · /healthz · 정적 파일"]
  end
  subgraph SH["@bh/shared · 결정적 게임 규칙"]
    ST["step(world, inputs, dt)"]
    CF["CONFIG<br/>모든 조정 수치"]
  end
  C <-->|"WebSocket (Colyseus)<br/>input · start · again →<br/>← 상태 패치 · event · roundError"| R
  R -->|"매 틱 실행"| ST
  C -->|"예측 이동 · 시야 계산에<br/>같은 코드 사용"| SH
  A -.->|"npm run serve:<br/>빌드된 client/dist 제공"| B
  E2E["e2e/ Playwright"] -.->|"npm run e2e"| A
```

## 2. 클라이언트 모듈 (packages/client/src)

```mermaid
flowchart LR
  MAIN["main.ts<br/>화면 전환 · 방 입장 · 재접속"]
  MAIN --> SCREENS["ui/screens.ts<br/>첫 화면 · 대기실 · 결과"]
  MAIN --> NET["net/<br/>connection.ts (@colyseus/sdk)<br/>url.ts (?room= 초대 링크)"]
  MAIN --> GAME["game.ts<br/>rAF 프레임 루프"]
  GAME --> IN
  GAME --> SIM
  GAME --> RND
  GAME --> UI["ui/hud.ts · ui/menu.ts (Esc)"]
  GAME --> AU
  subgraph IN["input/"]
    direction TB
    KB["keyboard.ts<br/>키·마우스 → InputState"]
    CLK["sampleClock.ts<br/>60Hz 고정 샘플 · alpha"]
    SND["sender.ts<br/>33ms마다 묶어 전송"]
  end
  subgraph SIM["sim/"]
    direction TB
    PRED["prediction.ts<br/>내 캐릭터 예측 · 보정"]
    SMO["smoothing.ts<br/>예측 사이 보간"]
    INT["interpolation.ts<br/>다른 엔티티 100ms 지연 보간"]
    SNAP["snapshot.ts<br/>스키마 → 순수 상태"]
  end
  subgraph RND["render/"]
    direction TB
    REN["renderer.ts"] --> CAM["camera.ts"] & MAPL["mapLayer.ts<br/>바닥·벽"] & LIT["lighting.ts<br/>어둠 · 손전등"] & DT["drawTable.ts<br/>엔티티 그리기"]
    VIS["visibility.ts<br/>보이는 것만 남김"]
  end
  subgraph AU["audio/"]
    direction TB
    DIR["director.ts<br/>상황 → 효과음"] --> AUD["audio.ts"] --> SPA["spatial.ts<br/>거리·방향"]
  end
```

## 3. 서버와 공용 규칙 모듈

```mermaid
flowchart LR
  subgraph SERVER["packages/server/src"]
    direction TB
    IDX["index.ts<br/>실행 진입점 · 포트 2567"] --> APP["app.ts<br/>express · /healthz · 정적 파일"] --> ROOM["RoundRoom.ts<br/>대기실 · 20Hz 틱 · 입력 큐<br/>재접속 유예 · 메시지 제한"]
    ROOM --> LOBBY["lobby.ts<br/>닉네임 · 방장 넘기기"]
    ROOM --> SCHEMA["schema.ts<br/>World → 동기화 스키마"]
  end
  subgraph SHARED["packages/shared/src (결정적 · 순수 함수)"]
    direction TB
    STEP["step.ts<br/>step(world, inputs, dt)"]
    STEP --> INP["input.ts<br/>sanitize · cap"]
    STEP --> MOVE["movement.ts<br/>이동 · 스태미나 · 계단"]
    STEP --> ITEMS["items.ts<br/>줍기 · 버리기 · 적재"]
    STEP --> GHOST["ghost.ts<br/>유령 이동 · 깜빡이기"]
    STEP --> COMMS["comms.ts<br/>핑 · 퀵챗"]
    STEP --> NOISE["noise.ts<br/>소음"]
    STEP --> MON["monsters/<br/>stalker (추적형) · watcher (시선형)"]
    STEP --> ROUND["round.ts<br/>createWorld · 시계 · 출발 판정"]
    MON --> PATH["pathfinding.ts<br/>A*"]
    MON --> VISION["vision.ts<br/>시야 · 손전등 판정"]
    MOVE & PATH & VISION --> MAP["map/<br/>parking-lot.json · grid · validate"]
    CONFIG["config.ts<br/>CONFIG: 모든 조정 수치"]
    MISC["rng · geometry · roomCode · types"]
  end
  ROOM -->|"매 틱"| STEP
  ROOM -->|"createWorld"| ROUND
```

## 4. 한 프레임 · 한 틱의 데이터 흐름

```mermaid
sequenceDiagram
  autonumber
  participant P as 플레이어
  participant G as game.ts (rAF)
  participant PR as prediction + smoothing
  participant SD as sender.ts
  participant RM as RoundRoom (20Hz)
  participant SH as shared step()
  participant O as 다른 클라이언트

  P->>G: 키·마우스 (keyboard.ts → InputState)
  loop 매 프레임 (모니터 주사율)
    G->>G: sampleClock: 1/60초마다 입력 샘플
    G->>PR: 샘플마다 1/60초 예측 이동
    G->>SD: 입력 쌓기 (seq 증가)
    G->>G: 직전·현재 예측을 alpha로 보간해 그림 · 카메라 따라감
  end
  SD->>RM: 33ms마다 input 묶음
  RM->>RM: 큐에 넣기 (최대 10개)
  loop 50ms 틱
    RM->>SH: step(world, 큐, dt)
    SH->>SH: 입력마다 1/60초 적용 (흐른 시간 예산만큼)<br/>→ 상호작용 → 배터리 → 몬스터 → 피해·사망 → 출발·시계
    SH-->>RM: 새 world · events
    RM->>RM: 쓰지 않은 입력은 큐에 남김
    RM-->>G: 상태 패치 (schema) + event
    RM-->>O: 상태 패치 + event
  end
  G->>PR: reconcile: 서버 위치 + 아직 처리 안 된 입력 다시 적용
  O->>O: 다른 엔티티는 100ms 지연 보간해 그림
```
