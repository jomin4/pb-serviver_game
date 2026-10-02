// 개발 모드: 서버(2567)와 클라이언트 개발 서버(5173)를 동시에 띄운다. 클라이언트 패키지가 아직 없으면 서버만 띄운다.
import { hasWorkspace, run } from './run.mjs';

const procs = [run(['run', 'dev', '-w', '@bh/server'])];
if (hasWorkspace('client')) procs.push(run(['run', 'dev', '-w', '@bh/client']));
else console.warn('[dev] packages/client가 없어 서버만 실행합니다.');

const stop = () => { for (const p of procs) p.child.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// 한쪽이 끝나면 나머지도 정리하고 같은 코드로 끝낸다.
const code = await Promise.race(procs.map((p) => p.done));
stop();
process.exit(code);
