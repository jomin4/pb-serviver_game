// 크로스플랫폼 실행 도우미. `&`나 인라인 환경변수 없이 npm 스크립트를 순서대로/동시에 돌린다.
//
// 자식 정리: npm(그리고 Windows에서는 cmd.exe) 래퍼만 죽이면 그 아래의 실제 서버(tsx, vite)가 고아로 남아
// 포트(2567/5173)를 계속 잡는다. 그래서 프로세스 트리 전체를 죽인다.
// - Windows: `taskkill /pid <pid> /T /F`로 트리를 죽인다.
// - POSIX: 자식을 `detached`로 띄워 자기 프로세스 그룹의 리더로 만들고, 그룹(-pid)에 신호를 보낸다.
//   detached 자식은 터미널의 Ctrl+C(SIGINT)·창 닫기(SIGHUP)를 직접 받지 않으므로 이 스크립트가 받아서 넘긴다.
//   stdin은 넘기지 않는다: 백그라운드 그룹이 터미널을 읽으면 SIGTTIN으로 멈추기 때문(vite·tsx 단축키는 꺼진다).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

/** 종료를 기다리는 기본 시간(ms). 넘기면 강제로 죽인다. */
const STOP_TIMEOUT_MS = 5000;

export const hasWorkspace = (name) => existsSync(join(root, 'packages', name, 'package.json'));

/** npm을 자식 프로세스로 실행한다. `done`은 npm 래퍼의 종료 코드로 끝난다. */
export function run(args, env = {}) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
    shell: isWin,
    detached: !isWin,
  });
  const done = new Promise((resolveExit) => {
    child.on('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    child.on('error', () => resolveExit(1));
  });
  return { child, done };
}

/** POSIX: 이 그룹에 살아 있는 프로세스가 있는가. */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** 자식의 프로세스 트리 전체에 신호를 보낸다. 이미 끝났으면 아무것도 하지 않는다. */
export function killTree(child, signal = 'SIGTERM') {
  const { pid } = child;
  if (pid === undefined) return;
  if (isWin) {
    // Windows에는 신호가 없다. /T: 자식 트리 전체, /F: 강제.
    if (child.exitCode === null && child.signalCode === null) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // 그룹이 이미 없다(ESRCH).
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 트리가 끝날 때까지 기다린다. POSIX에서는 래퍼뿐 아니라 그룹 전체가 사라질 때까지. 시간 안에 끝나면 true. */
async function waitGone(proc, deadline) {
  const wrapperDone = await Promise.race([proc.done.then(() => true), sleep(Math.max(0, deadline - Date.now())).then(() => false)]);
  if (!wrapperDone) return false;
  if (isWin || proc.child.pid === undefined) return true;
  while (groupAlive(proc.child.pid)) {
    if (Date.now() >= deadline) return false;
    await sleep(50);
  }
  return true;
}

/** 모든 자식 트리에 SIGTERM을 보내고 끝나기를 기다린다. `timeoutMs` 안에 끝나지 않은 것은 SIGKILL. */
export async function stopAll(procs, timeoutMs = STOP_TIMEOUT_MS) {
  for (const p of procs) killTree(p.child, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  const gone = await Promise.all(procs.map((p) => waitGone(p, deadline)));
  procs.forEach((p, i) => { if (!gone[i]) killTree(p.child, 'SIGKILL'); });
}

/**
 * SIGINT/SIGTERM/SIGHUP을 받으면 `procs()`의 자식 트리를 모두 정리하고 끝낸다(한 번만).
 * 돌려주는 `shutdown(code)`는 스크립트가 스스로 끝낼 때도 같은 정리 절차를 쓰게 한다.
 */
export function onShutdown(procs) {
  let stopping = null;
  const shutdown = (code) => {
    stopping ??= stopAll(procs()).then(() => process.exit(code));
    return stopping;
  };
  const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  for (const [signal, code] of Object.entries(codes)) process.on(signal, () => void shutdown(code));
  return { shutdown, isStopping: () => stopping !== null };
}

export { root };
