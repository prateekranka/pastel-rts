/// <reference types="vite/client" />

declare const __APP_COMMIT__: string;
declare const __APP_BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_CONTENT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
