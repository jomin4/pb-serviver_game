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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:2567',
    viewport: { width: 1280, height: 720 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
});
