import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import express from 'express';
import { defineRoom, defineServer } from 'colyseus';
import { RoundRoom } from './RoundRoom.ts';
import { GAME_VERSION } from './version.ts';

export { RoundRoom };

export type GameServerOptions = {
  /** 빌드된 클라이언트 폴더. 주면 같은 포트로 정적 파일과 `index.html`을 제공한다. */
  staticDir?: string;
};

/** 정적 파일 대신 index.html로 연결하지 않는 경로 접두어(서버 API). */
const API_PREFIXES = ['/matchmake', '/healthz', '/__healthcheck'];

const isApiPath = (path: string): boolean =>
  API_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

/** 방 정의와 HTTP 라우트(헬스체크, 정적 파일)를 갖춘 Colyseus 서버를 만든다. 방 정의는 여기 한 곳에만 둔다. */
export function createGameServer(opts: GameServerOptions = {}) {
  const { staticDir } = opts;
  return defineServer({
    rooms: { round: defineRoom(RoundRoom) },
    express: (app) => {
      app.get('/healthz', (_req, res) => { res.json({ ok: true, version: GAME_VERSION }); });
      if (!staticDir) return;
      const root = resolve(staticDir);
      const index = join(root, 'index.html');
      app.use(express.static(root));
      // `/?room=CODE` 같은 주소로도 앱이 열리도록 알 수 없는 GET 경로는 index.html로 보낸다.
      // 확장자가 있는 경로(없는 정적 파일)와 서버 API 경로는 건드리지 않는다.
      app.use((req, res, next) => {
        const isRead = req.method === 'GET' || req.method === 'HEAD';
        if (!isRead || isApiPath(req.path) || extname(req.path) !== '' || !existsSync(index)) { next(); return; }
        res.sendFile(index, (err) => { if (err) next(err); });
      });
    },
  });
}

export const server = createGameServer();
