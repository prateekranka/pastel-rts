import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const foundryRoot = resolve(scriptRoot, '../apps/foundry');
const contentPort = Number(process.env['STUDIO_CONTENT_PORT'] ?? 8787);
const foundryPort = Number(process.env['STUDIO_FOUNDRY_PORT'] ?? 5174);

export default defineConfig({
  root: foundryRoot,
  base: './',
  resolve: {
    alias: {
      '@pastel-rts/content-schema': resolve(foundryRoot, 'src/schema/browser.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: foundryPort,
    strictPort: true,
    proxy: {
      '/dev-content': {
        target: `http://127.0.0.1:${contentPort}`,
        rewrite: (path) => path.replace(/^\/dev-content/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: foundryPort + 1000,
    strictPort: true,
  },
});
