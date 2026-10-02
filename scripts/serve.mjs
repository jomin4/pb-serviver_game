// 친구 테스트용: 클라이언트를 빌드한 뒤 서버가 packages/client/dist를 같은 포트로 제공한다.
import { join } from 'node:path';
import { root, run } from './run.mjs';

const build = await run(['run', 'build']).done;
if (build !== 0) process.exit(build);

const server = run(['run', 'start', '-w', '@bh/server'], { STATIC_DIR: join(root, 'packages', 'client', 'dist') });
const stop = () => server.child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.exit(await server.done);
