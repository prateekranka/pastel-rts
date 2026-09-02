#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iosDir = join(dirname(fileURLToPath(import.meta.url)), '../apps/ios-shell');
const result = spawnSync('xcodegen', ['generate'], { cwd: iosDir, stdio: 'inherit' });
if (result.error && result.error.code === 'ENOENT') {
  console.error('xcodegen is not installed. On macOS: brew install xcodegen');
  console.error('Then run: (cd apps/ios-shell && xcodegen generate && open PastelRTS.xcodeproj)');
  process.exit(1);
}
process.exit(result.status ?? 1);
