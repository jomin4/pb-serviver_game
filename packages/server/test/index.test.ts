import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ColyseusSDK } from '@colyseus/sdk';
import { MAP_IDS } from '@bh/shared';
import { startServer } from '../src/index.ts';
import { GAME_VERSION } from '../src/version.ts';

// getMap을 가로채 맵 검증 실패를 흉내 낸다. 평소에는 원본을 그대로 돌려준다.
const hooks = vi.hoisted(() => ({ breakMaps: false }));
vi.mock('@bh/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bh/shared')>();
  return {
    ...actual,
    getMap: (id: string) => {
      const map = actual.getMap(id);
      return hooks.breakMaps ? { ...map, itemSlots: [] } : map;
    },
  };
});

// 포트 0으로 띄워 운영체제가 빈 포트를 고르게 한다. 고정 포트를 쓰는 다른 테스트(2568, 2569)와 겹치지 않는다.
type Started = Awaited<ReturnType<typeof startServer>>;
const open: Started[] = [];
const dirs: string[] = [];
const start = async (staticDir?: string): Promise<{ s: Started; url: string }> => {
  const s = await startServer({ port: 0, staticDir });
  open.push(s);
  return { s, url: `http://127.0.0.1:${s.port}` };
};
const makeStaticDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'bh-static-'));
  dirs.push(dir);
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>basement</title><div id="app"></div>');
  await writeFile(join(dir, 'app.js'), 'console.log("hi");');
  return dir;
};

afterEach(async () => {
  hooks.breakMaps = false;
  await Promise.all(open.splice(0).map(s => s.close()));
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('startServer', () => {
  it('healthz는 버전을 돌려준다', async () => {
    const { url } = await start();
    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true, version: GAME_VERSION });
  });

  it('staticDir의 index.html을 제공한다', async () => {
    const { url } = await start(await makeStaticDir());
    const root = await fetch(`${url}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('<div id="app">');
    const js = await fetch(`${url}/app.js`);
    expect(js.status).toBe(200);
    expect(await js.text()).toBe('console.log("hi");');
  });

  it('방 코드 쿼리가 붙은 주소와 알 수 없는 경로도 index.html로 연다', async () => {
    const { url } = await start(await makeStaticDir());
    for (const path of ['/?room=ABC234', '/lobby/ABC234']) {
      const res = await fetch(`${url}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<div id="app">');
    }
  });

  it('healthz와 matchmake 경로, 없는 정적 파일은 index.html로 덮지 않는다', async () => {
    const { url } = await start(await makeStaticDir());
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ ok: true, version: GAME_VERSION });
    const missing = await fetch(`${url}/missing.js`);
    expect(missing.status).toBe(404);
    const post = await fetch(`${url}/nothing`, { method: 'POST' });
    expect(post.status).toBe(404);
    const mm = await fetch(`${url}/matchmake/joinById/NOROOM`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(mm.headers.get('content-type') ?? '').not.toContain('text/html');
  });

  it('staticDir이 없으면 정적 파일을 제공하지 않는다', async () => {
    const { url } = await start();
    const res = await fetch(`${url}/app.js`);
    expect(res.status).toBe(404);
  });

  it('같은 서버에서 Colyseus 방에 실제로 접속할 수 있다', async () => {
    const { url } = await start(await makeStaticDir());
    const sdk = new ColyseusSDK(url.replace('http', 'ws'));
    const room = await sdk.create('round', { name: '철수', version: GAME_VERSION });
    expect(room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await room.leave();
  });

  it('close 이후에는 연결을 받지 않는다', async () => {
    const { s, url } = await start();
    await s.close();
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });

  it('맵 검증 실패 시 시작하지 않는다', async () => {
    hooks.breakMaps = true;
    const err = await startServer({ port: 0 }).then(
      async s => { await s.close(); return null; },
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(`Invalid map ${MAP_IDS[0]}`);
  });
});
