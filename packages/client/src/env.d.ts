/// <reference types="vite/client" />

declare const __GAME_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface Window {
  /** 디버그 훅(개발 서버 또는 `?debug=1`). E2E가 내 id와 상태 스냅숏을 읽는다. */
  __bhDebug?: {
    readonly selfId: string | null;
    getState(): unknown;
    getRender(): unknown;
  };
}
