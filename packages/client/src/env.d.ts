/// <reference types="vite/client" />

declare const __GAME_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}
