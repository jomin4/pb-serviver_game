import { defineConfig } from 'vite';
import rootPkg from '../../package.json' with { type: 'json' };

export default defineConfig({
  // 서버 입장 옵션 version으로 보낸다. 서버의 GAME_VERSION(루트 package.json)과 같은 값.
  define: { __GAME_VERSION__: JSON.stringify(rootPkg.version) },
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
