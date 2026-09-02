import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
