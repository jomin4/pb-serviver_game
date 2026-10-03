import { defineConfig } from '@playwright/test';

/**
 * E2E는 친구와 하는 경로(`npm run serve`: 클라이언트 빌드 후 서버가 정적 파일까지 제공)를 그대로 쓴다.
 * 브라우저가 따로 설치된 환경이면 PLAYWRIGHT_CHROMIUM_PATH로 실행 파일을 지정한다.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/artifacts',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:2567',
    // 이미 떠 있는 서버를 재사용한다. 최신 빌드를 테스트하려면 먼저 `npm run serve`를 종료한다.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // 끝낼 때 SIGTERM을 보내 serve.mjs가 서버 프로세스 그룹(detached)까지 정리하게 한다.
    // 기본값(바로 SIGKILL)이면 serve.mjs가 정리하지 못해 서버가 고아로 남고 Playwright도 종료를 기다리며 멈춘다.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  use: {
    baseURL: 'http://localhost:2567',
    viewport: { width: 1280, height: 720 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
});
