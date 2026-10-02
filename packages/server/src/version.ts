import pkg from '../../../package.json' with { type: 'json' };

/** 빌드 버전. 클라이언트는 같은 값을 입장 옵션 `version`으로 보낸다. */
export const GAME_VERSION: string = pkg.version;
