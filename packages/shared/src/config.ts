export const CONFIG = {
  tickMs: 50,
  patchMs: 50,
  inputSendMs: 33,
  reconnectSeconds: 20,
  maxPlayers: 4,
  realSecondsPerGameMinute: 3,
  roundEndClock: 240,
  watcherSpawnClock: 30,
  lightsHalfClock: 180,
  hornClock: 230,
  player: {
    radius: 0.35,
    walkSpeed: 3,
    runSpeed: 5,
    staminaMax: 5,
    staminaDrain: 1,
    staminaRegen: 1,
    staminaRecoverToRun: 1,
    hp: 2,
    ambientRadius: 1.5,
    slots: 3,
    weightSlowPerKg: 0.01,
    weightSlowMax: 0.3,
    interactRange: 1.2,
    departHoldSeconds: 3,
  },
  movement: { maxStep: 0.25 },
  flashlight: { angle: Math.PI / 3, range: 8, batteryMax: 180, drainPerSecond: 1 },
  noise: { walk: 1.5, run: 8, drop: 6 },
  items: {
    countAt4: 25,
    minCount: 10,
    valueMin: 10,
    valueMax: 80,
    weightMin: 2,
    weightMax: 15,
    totalFactor: 1.8,
  },
  difficulty: {
    1: { target: 150, stalkers: 1, stalkerSpeedMul: 0.85 },
    2: { target: 250, stalkers: 1, stalkerSpeedMul: 1 },
    3: { target: 350, stalkers: 2, stalkerSpeedMul: 1 },
    4: { target: 450, stalkers: 2, stalkerSpeedMul: 1 },
  },
  stalker: {
    patrolSpeed: 2.5,
    investigateSpeed: 3.5,
    chaseSpeed: 4.5,
    sightRange: 6,
    loseSeconds: 5,
    searchSeconds: 5,
    retreatSeconds: 3,
    lateSpeedMul: 1.1,
    radius: 0.4,
  },
  watcher: { speed: 5.5, radius: 0.4, waitSeconds: 1 },
  ghost: { speed: 6, flickerRadius: 3, flickerSeconds: 1.5, flickerCooldown: 10 },
  comms: {
    pingSeconds: 3,
    pingCooldown: 3,
    chatCooldown: 1,
    quickChats: ['여기로', '도와줘!', '폐품 있음', '도망쳐!', '비춰줘!', '트럭으로'],
  },
  net: {
    maxMessagesPerSecond: 60, maxInputsPerBatch: 10, maxDt: 0.1, nicknameMax: 10, roomCodeLength: 6, interpolationMs: 100,
    /** 클라이언트가 입력을 샘플링하는 고정 빈도(Hz). 모니터 주사율과 무관하게 서버 틱당 입력 수를 한도 아래로 유지한다. */
    inputSampleHz: 60,
    /**
     * 서버가 입력 하나를 1/inputSampleHz초로 적용할 때 쌓아 둘 수 있는 입력 시간(초). 늦게 온 입력을 이만큼까지
     * 따라잡고, 입력이 끊기면 이를 넘는 시간은 중립 입력으로 흐른다. 많이 보내도 이보다 빨리 움직일 수 없다.
     */
    inputBudgetMax: 0.2,
  },
  /** 화면 기준 해상도(px)와 1타일의 기준 px(스펙 4.1). */
  view: { width: 960, height: 540, tilePx: 32 },
  fx: {
    dangerDistance: 5,
    /** 어둠 레이어 불투명도: 생존자 / 유령(스펙 4.3). */
    darknessAlpha: 0.95,
    ghostDarknessAlpha: 0.6,
    /** 깜빡이는 조명의 점멸 빈도: Math.floor(t * flickerBlinkHz) % 2일 때 켜짐. */
    flickerBlinkHz: 12,
    /** 트럭 구역(출입구) 주변의 넓은 빛 반경(타일). */
    truckLightRadius: 6,
    /** 빛 가장자리 흐림: 반경 대비 이 비율부터 어두워진다. */
    lightSoftEdge: 0.6,
    /** 화면 밖 광원도 반경 + 여유(타일)가 화면에 닿으면 계산한다. */
    lightCullMargin: 2,
    shakeSeconds: 0.3,
    shakeTiles: 0.18,
    /** 유령끼리 보일 때의 불투명도. */
    ghostAlpha: 0.45,
    chatLogSize: 5,
    /** HUD 안내(경적, 사망 등) 표시 시간(초). */
    noticeSeconds: 4,
  },
  pathfinding: { stairsCost: 1 },
  /** 클라이언트 소리(스펙 4.4). 거리는 타일, 시간은 초, 음량은 0~1 배율(마스터 음량에 곱한다). */
  audio: {
    /** 설정을 읽지 못할 때의 기본값. */
    defaultEnabled: true,
    defaultVolume: 0.8,
    /** 소리 종류별로 들리는 최대 거리. 이보다 멀면(또는 다른 층이면) 재생하지 않는다. */
    maxDistance: { stalkerStep: 12, watcherDrag: 14, teammateRun: 10 },
    volume: {
      stalkerStep: 0.9, watcherDrag: 0.5, teammateRun: 0.5, pickup: 0.5, buzz: 0.35, horn: 0.7, heartbeat: 0.9, ambient: 0.12,
    },
    /** 추적형이 이동하는 동안 발소리 간격. */
    stalkerStepInterval: 0.5,
    /** 보간한 위치가 한 프레임에 이만큼(타일) 넘게 움직여야 이동으로 본다. */
    movedEpsilon: 0.005,
    /** 소음 이벤트 위치가 내 위치와 이 거리 안이면 내 소음으로 보고 무시한다. */
    selfNoiseTolerance: 1.5,
    /** 동료 뛰는 소리 최소 간격(서버는 틱마다 소음을 낸다). */
    teammateRunInterval: 0.25,
    /** 같은 층에서 이 거리(타일) 안의 뛰는 소음은 같은 동료의 것으로 보고 간격을 함께 센다. */
    teammateRunSourceRadius: 1.5,
    /** 지직거리는 형광등이 들리는 거리, 그리고 지직 소리 최소 간격. */
    buzzRange: 6,
    buzzMinInterval: 0.08,
    /** 심장 소리 박동 간격: 위험 거리 끝에서 / 바로 곁에서. */
    heartbeatSlowInterval: 1,
    heartbeatFastInterval: 0.45,
    /** 마스터 음량이 바뀔 때 부드럽게 따라가는 시간 상수. */
    fadeSeconds: 0.03,
  },
} as const;
