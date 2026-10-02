// 개발 모드: 서버(2567)와 클라이언트 개발 서버(5173)를 동시에 띄운다. 클라이언트 패키지가 아직 없으면 서버만 띄운다.
// 종료(Ctrl+C·SIGTERM) 시 두 프로세스 트리를 모두 정리하고 끝낸다(run.mjs 참고).
import { hasWorkspace, onShutdown, run } from './run.mjs';

const procs = [{ name: '서버', ...run(['run', 'dev', '-w', '@bh/server']) }];
if (hasWorkspace('client')) procs.push({ name: '클라이언트 개발 서버', ...run(['run', 'dev', '-w', '@bh/client']) });
else console.warn('[dev] packages/client가 없어 서버만 실행합니다.');

const { shutdown, isStopping } = onShutdown(() => procs);

// 한쪽이 스스로 끝나면(예: 포트가 이미 사용 중) 나머지 트리도 정리하고 0이 아닌 코드로 끝낸다.
const first = await Promise.race(procs.map((p) => p.done.then((code) => ({ name: p.name, code }))));
if (!isStopping()) {
  console.error(`[dev] ${first.name} 프로세스가 종료되었습니다(코드 ${first.code}). 나머지도 정리합니다. 포트 2567/5173을 이미 다른 프로세스가 쓰고 있지 않은지 확인하세요.`);
  await shutdown(first.code || 1);
}
