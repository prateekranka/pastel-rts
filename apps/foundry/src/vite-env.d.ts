/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_WEB_ORIGIN?: string;
  readonly VITE_SANDBOX_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
