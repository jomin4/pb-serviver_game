# 지하주차장 (basement-horror)

오래된 아파트 지하주차장에서 친구 1~4명이 브라우저 링크 하나로 모여 즐기는 2D 탑다운 협동 서바이벌 공포 게임.

**핵심 루프**: 어둠 속에 들어가 폐품을 모으고, 추적형·시선형 괴물을 피해, 제한 시간 안에 트럭에 싣고 빠져나온다.

## 요구사항

- Node.js 22.12 이상 (LTS 권장)
- Git
- (친구와 할 때) 각자 PC 브라우저. 친구는 아무것도 설치하지 않아도 된다.

## 설치와 개발

```bash
git clone https://github.com/jomin4/pb-serviver_game.git
cd pb-serviver_game
git checkout ccr-07fd93bb-obo8mr
npm install
npm run dev
```

(게임은 아직 `ccr-07fd93bb-obo8mr` 브랜치에만 있다. 이 브랜치가 main에 합쳐지면 `git checkout` 단계는 필요 없다.)

브라우저에서 http://localhost:5173 을 연다. (서버는 2567, Vite 개발 서버는 5173 포트를 쓴다.)

## 테스트

```bash
npm test        # 타입 검사 + 단위·시나리오·통합 테스트 (브라우저 필요 없음)
npm run e2e     # Playwright E2E: 두 명이 초대 링크로 모여 플레이
```

`npm run e2e`는 클라이언트를 빌드하고 서버를 띄운 뒤(`npm run serve`) 실제 브라우저로 확인한다.
이미 `npm run serve`가 실행 중이면 그 서버를 재사용하므로, 최신 빌드를 테스트하려면 먼저 종료하고 실행한다.
스크린샷은 `test-results/`(git에 포함되지 않음)에 저장된다.

- 일반 PC(Windows 포함): 처음 한 번만 `npx playwright install chromium` 을 실행한 뒤 `npm run e2e` 를 실행한다.
- 클라우드 세션처럼 Playwright 브라우저를 설치할 수 없는 환경에서만, 이미 있는 Chromium 경로를 지정한다. 아래 줄은 그 환경 전용이다.

  ```bash
  PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e
  ```

## 친구와 하기

1. 내 PC에서 서버를 띄운다. 클라이언트를 빌드해 같은 포트로 제공한다.

   ```bash
   npm run serve
   ```

   http://localhost:2567 에서 직접 확인해 볼 수 있다.

2. `cloudflared`는 별도 프로그램이라 먼저 설치한다.
   - Windows: `winget install --id Cloudflare.cloudflared` (설치 후 새 터미널을 연다)
   - macOS: `brew install cloudflared`
   - 그 밖: [Cloudflare 다운로드 페이지](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

   다른 터미널에서 [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)로 공개한다.

   ```bash
   cloudflared tunnel --url http://localhost:2567
   ```

   터널 주소는 실행할 때마다 바뀌며, 플레이하는 동안 서버 터미널과 터널 터미널을 모두 열어 두어야 한다.

3. 출력된 `https://....trycloudflare.com` 주소로 접속해 닉네임을 입력하고 "방 만들기"를 누른다.
4. 대기실의 "링크 복사" 버튼으로 초대 링크를 복사해 친구에게 보낸다. 링크에 `?room=코드`가 이미 들어 있다.
   (주소만 공유했다면 뒤에 `?room=코드`를 직접 붙여도 된다.)
5. 모두 모이면 방장이 "시작"을 누른다.

## PC Remote Control로 개발 이어가기

PC에 Claude Code가 설치되어 있고 로그인되어 있어야 한다. 개발 중인 저장소 폴더에서 아래 명령을 실행해 두면, 휴대폰 Claude 앱에서 그 세션을 이어서 쓸 수 있다.

```bash
claude remote-control
```

## 조작키 (PC)

| 키 | 살아 있을 때 | 유령일 때 |
|---|---|---|
| WASD | 이동 | 이동 |
| Shift | 뛰기 | 없음 |
| 마우스 이동 | 손전등 조준 | 없음 |
| 좌클릭 / F | 손전등 켜기/끄기 | 형광등 깜빡이기 |
| E | 줍기, 트럭에 싣기, 3초 길게 눌러 조기 출발 | 없음 |
| G | 선택한 칸의 폐품 버리기 | 없음 |
| 1~3 / 마우스 휠 | 소지품 칸 선택 | 없음 |
| Q | 마우스 위치에 핑 | 마우스 위치에 핑 |
| T 누른 상태 + 1~6 | 퀵챗 | 퀵챗 |
| Esc | 메뉴(소리, 나가기) | 메뉴 |

## 직접 플레이 체크리스트

친구들과 한 판 한 뒤 확인한다.

- [ ] 어둠 속에서 무서운가? 소리가 경고 역할을 하는가?
- [ ] 시선형 때문에 "비춰줘!" 같은 협동이 생기는가?
- [ ] 03:50 경적 이후 "한 번 더 들어갈까" 고민이 생기는가?
- [ ] 먼저 죽은 사람도 유령으로 계속 즐거운가?
- [ ] 끝나고 "한 판 더"가 나오는가?

## 폴더 구조

- `packages/shared` — 게임 규칙 전체. 순수 TypeScript, 네트워크와 화면을 모른다.
- `packages/server` — Colyseus 방. 입력을 모아 규칙을 고정 주기로 실행하고, 빌드된 클라이언트를 같은 포트로 제공한다.
- `packages/client` — Vite 기반 화면: 로비, 입력, Canvas 렌더링(조명), HUD, 소리.
- `e2e/` — Playwright E2E 테스트.
- `scripts/` — `dev`, `serve` 실행 스크립트.

## 문서

- 설계: [docs/superpowers/specs/2026-10-02-basement-horror-round-design.md](docs/superpowers/specs/2026-10-02-basement-horror-round-design.md)
- 구현 계획: [docs/superpowers/plans/2026-10-02-basement-horror-round.md](docs/superpowers/plans/2026-10-02-basement-horror-round.md)

## 개발 워크플로우와 스킬

새 기능은 `CLAUDE.md`의 규칙을 따른다: brainstorming → 설계 승인 → writing-plans → TDD.
`.claude/skills/`의 스킬은 [obra/superpowers](https://github.com/obra/superpowers)(커밋 `8ca22db`)에서 가져왔으며 MIT 라이선스다(`.claude/skills/LICENSE-superpowers`).
