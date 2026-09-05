import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const gameWebRoot = dirname(fileURLToPath(import.meta.url));
const packV2Root = resolve(process.env['PACK_V2_DIR'] ?? resolve(gameWebRoot, '../../content/dev-pack-v2'));
const PACK_PREFIX = '/content/dev-pack-v2';
const contentPort = Number(process.env['CONTENT_PORT'] ?? 8787);
const gamePort = Number(process.env['GAME_PORT'] ?? 5173);
const gameHost = process.env['GAME_HOST'] ?? '127.0.0.1';
const previewPort = Number(process.env['PREVIEW_PORT'] ?? 4173);

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function servePackV2(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = req.url ?? '';
  if (!url.startsWith(PACK_PREFIX)) {
    next();
    return;
  }
  const rel = decodeURIComponent(url.slice(PACK_PREFIX.length).split('?')[0] ?? '');
  const target = resolve(packV2Root, `.${rel === '' || rel === '/' ? '/pack.json' : rel}`);
  const relativePath = relative(packV2Root, target);
  if (relativePath.startsWith('..') || normalize(relativePath).startsWith('..')) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', MIME[extname(target)] ?? 'application/octet-stream');
  createReadStream(target).pipe(res);
}

function copyPackV2ToDist(outDir: string): void {
  const resolvedOutDir = resolve(outDir);
  if (!existsSync(join(packV2Root, 'pack.json'))) {
    throw new Error(`Missing Pack v2 source at ${join(packV2Root, 'pack.json')}`);
  }
  const dest = join(resolvedOutDir, 'content/dev-pack-v2');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(packV2Root, dest, { recursive: true });
}

function packV2Plugin(): Plugin {
  return {
    name: 'pastel-pack-v2',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(servePackV2);
    },
    writeBundle(options) {
      copyPackV2ToDist(options.dir ?? resolve(gameWebRoot, 'dist'));
    },
    closeBundle() {
      copyPackV2ToDist(resolve(gameWebRoot, 'dist'));
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(process.env['GIT_COMMIT'] ?? gitCommit()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: gameHost,
    port: gamePort,
    strictPort: true,
    fs: {
      allow: [resolve(gameWebRoot, '../..')],
    },
    proxy: {
      '/dev-content': {
        target: `http://127.0.0.1:${contentPort}`,
        rewrite: (path) => path.replace(/^\/dev-content/, ''),
      },
      '/dev-content-ws': {
        target: `ws://127.0.0.1:${contentPort}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/dev-content-ws/, '/ws'),
      },
    },
  },
  preview: {
    host: gameHost,
    port: previewPort,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  plugins: [packV2Plugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
