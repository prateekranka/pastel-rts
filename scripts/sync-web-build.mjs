import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps/game-web/dist');
const dest = join(root, 'apps/ios-shell/PastelRTS/WebGame');

if (!existsSync(dist) || !existsSync(join(dist, 'index.html'))) {
  console.error('Missing apps/game-web/dist. Run `npm run build` first.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(dist, dest, { recursive: true });
writeFileSync(join(dest, '.gitkeep'), '');
console.log(`Synced production web build to ${dest}`);
