import { existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_IDS, getMap, itemCountFor, validateMap } from '@bh/shared';
import { createGameServer } from './app.ts';

export type StartOptions = { port: number; staticDir?: string };
export type RunningServer = {
  /** 실제로 바인딩된 포트. `port: 0`으로 시작했을 때 운영체제가 고른 값을 알려 준다. */
  port: number;
  close(): Promise<void>;
};

/** 모든 맵을 최대 인원(4명) 기준으로 검사한다. 하나라도 오류가 있으면 throw. */
export function assertMapsValid(): void {
  const needed = itemCountFor(4);
  for (const id of MAP_IDS) {
    const errors = validateMap(getMap(id), needed);
    if (errors.length > 0) throw new Error(`Invalid map ${id}: ${errors.join('; ')}`);
  }
}

/**
 * 포트가 비어 있는지 잠깐 열어 보고 닫는다. 쓰이고 있으면 EADDRINUSE 오류로 거부한다.
 * Colyseus의 listen은 EADDRINUSE를 uncaughtException으로 흘려 자체 종료 절차에서 멈춰 버리므로
 * (프로세스가 끝나지 않아 scripts/serve.mjs가 알아챌 수 없다) 직접 실행할 때 먼저 확인한다.
 */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  assertMapsValid();
  const server = createGameServer({ staticDir: opts.staticDir });
  await server.listen(opts.port);
  const address = server.transport.server?.address() as AddressInfo | string | null | undefined;
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return { port, close: () => server.gracefullyShutdown(false) };
}

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 2567;
const DEFAULT_STATIC_DIR = resolve(here, '../../client/dist');

/** `node`/`tsx`로 이 파일을 직접 실행했을 때만 true. 테스트가 import할 때는 서버를 띄우지 않는다. */
const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const staticDir = process.env.STATIC_DIR ?? (existsSync(DEFAULT_STATIC_DIR) ? DEFAULT_STATIC_DIR : undefined);
  try {
    await assertPortFree(port);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    console.error(`포트 ${port}을(를) 이미 다른 프로세스가 쓰고 있습니다. 이전에 띄운 서버를 끄거나 PORT 환경변수로 다른 포트를 지정하세요.`);
    process.exit(1);
  }
  const running = await startServer({ port, staticDir });
  console.log(`Server listening on http://localhost:${running.port}${staticDir ? ` (serving ${staticDir})` : ''}`);
  // SIGINT/SIGTERM은 Colyseus가 직접 처리한다(방 정리 후 종료). 여기서 같은 핸들러를 또 달면 이중 종료 오류가 난다.
}

if (isDirectRun()) {
  main().catch((err: unknown) => { console.error(err); process.exit(1); });
}
