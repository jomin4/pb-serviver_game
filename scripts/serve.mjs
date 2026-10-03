// 친구 테스트용: 클라이언트를 빌드한 뒤 서버가 packages/client/dist를 같은 포트로 제공한다.
// 종료(Ctrl+C·SIGTERM) 시 빌드·서버 프로세스 트리를 모두 정리하고 끝낸다(run.mjs 참고).
import { join } from 'node:path';
import { onShutdown, root, run } from './run.mjs';

let current = null;
const { shutdown, isStopping } = onShutdown(() => (current ? [current] : []));

current = run(['run', 'build']);
const build = await current.done;
if (isStopping()) await new Promise(() => {}); // 정리 중: shutdown이 끝낸다
if (build !== 0) {
  console.error(`[serve] 클라이언트 빌드가 실패했습니다(코드 ${build}).`);
  await shutdown(build);
}

current = run(['run', 'start', '-w', '@bh/server'], { STATIC_DIR: join(root, 'packages', 'client', 'dist') });
const code = await current.done;
if (!isStopping()) {
  // 스스로 끝났다(예: 포트 2567이 이미 사용 중 EADDRINUSE). 남은 트리를 정리하고 0이 아닌 코드로 끝낸다.
  console.error(`[serve] 서버가 종료되었습니다(코드 ${code}). 포트 2567을 이미 다른 프로세스가 쓰고 있지 않은지 확인하세요.`);
  await shutdown(code || 1);
}
