// 크로스플랫폼 실행 도우미. `&`나 인라인 환경변수 없이 npm 스크립트를 순서대로/동시에 돌린다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const hasWorkspace = (name) => existsSync(join(root, 'packages', name, 'package.json'));

/** npm을 자식 프로세스로 실행하고 종료 코드를 돌려준다. */
export function run(args, env = {}) {
  const child = spawn(npm, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  const done = new Promise((resolveExit) => {
    child.on('exit', (code) => resolveExit(code ?? 1));
    child.on('error', () => resolveExit(1));
  });
  return { child, done };
}

export { root };
