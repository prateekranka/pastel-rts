import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const browserSchema = resolve(here, 'src/schema/browser.ts');

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@pastel-rts/content-schema': browserSchema,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/dev-content': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/dev-content/, ''),
      },
    },
  },
  preview: {
    host: true,
    port: 4174,
    strictPort: true,
    proxy: {
      '/dev-content': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/dev-content/, ''),
      },
    },
  },
});
