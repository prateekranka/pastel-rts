import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(process.env['GIT_COMMIT'] ?? gitCommit()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/dev-content': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/dev-content/, ''),
      },
      '/dev-content-ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        rewrite: (path) => path.replace(/^\/dev-content-ws/, '/ws'),
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
