#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FOUNDY_CONFIG = join(REPO_ROOT, 'scripts/studio-foundry.vite.mjs');
const LOOPBACK = '127.0.0.1';

const DEFAULTS = {
  gamePort: 5173,
  foundryPort: 5174,
  contentPort: 8787,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  validatePorts(options);

  const children = [];
  let stopping = false;
  let firstFailure = null;
  let rejectFailure;
  let resolveLifecycle;
  const failurePromise = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  const lifecyclePromise = new Promise((resolvePromise) => {
    resolveLifecycle = resolvePromise;
  });

  const reportFailure = (error) => {
    if (firstFailure || stopping) {
      return;
    }
    firstFailure = error instanceof Error ? error : new Error(String(error));
    rejectFailure(firstFailure);
    resolveLifecycle();
  };

  const childEnv = {
    ...process.env,
    CONTENT_PACK_DIR: options.packDir,
    CONTENT_PORT: String(options.contentPort),
    STUDIO_CONTENT_PORT: String(options.contentPort),
    STUDIO_FOUNDRY_PORT: String(options.foundryPort),
  };

  const spawnService = (name, args) => {
    const child = spawn('npm', args, {
      cwd: REPO_ROOT,
      env: childEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { name, child };
    children.push(record);
    prefixStream(child.stdout, name);
    prefixStream(child.stderr, name);
    child.once('error', (error) => {
      reportFailure(`${name} process error: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      if (stopping) {
        return;
      }
      const status = signal ? `signal ${signal}` : `exit ${String(code ?? 'unknown')}`;
      reportFailure(`${name} stopped before studio shutdown (${status})`);
    });
    return record;
  };

  const signalHandler = () => {
    if (!stopping) {
      console.log('Studio shutdown requested. Stopping owned services.');
      stopping = true;
      resolveLifecycle();
    }
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  try {
    spawnService('game', [
      'run',
      'dev',
      '--workspace',
      '@pastel-rts/game-web',
      '--',
      '--host',
      LOOPBACK,
      '--port',
      String(options.gamePort),
      '--strictPort',
    ]);
    spawnService('foundry', [
      'run',
      'dev',
      '--workspace',
      '@pastel-rts/foundry',
      '--',
      '--config',
      FOUNDY_CONFIG,
      '--host',
      LOOPBACK,
      '--port',
      String(options.foundryPort),
      '--strictPort',
    ]);
    spawnService('content', ['run', 'dev:content']);

    await Promise.race([
      Promise.all([
        waitForHttp(`http://${LOOPBACK}:${options.gamePort}/`, 'game'),
        waitForHttp(`http://${LOOPBACK}:${options.foundryPort}/`, 'foundry'),
        waitForHttp(`http://${LOOPBACK}:${options.contentPort}/health`, 'content'),
      ]),
      failurePromise,
    ]);

    if (firstFailure) {
      throw firstFailure;
    }

    console.log('Studio ready (loopback only)');
    console.log(`  Game:    http://${LOOPBACK}:${options.gamePort}/`);
    console.log(`  Foundry: http://${LOOPBACK}:${options.foundryPort}/`);
    console.log(`  Content: http://${LOOPBACK}:${options.contentPort}/health`);
    console.log(`  Fixture: http://${LOOPBACK}:${options.gamePort}/content/dev-pack-v2/pack.json`);
    console.log(`  Pack dir: ${options.packDir}`);
    console.log('Press Ctrl-C to stop the three owned services.');
    await lifecyclePromise;
    if (firstFailure) {
      console.error(`Studio stopped because a service failed: ${firstFailure.message}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Studio failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    stopping = true;
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    await stopChildren(children);
  }
}

function parseArgs(argv) {
  const env = process.env;
  const values = {
    gamePort: portFromEnv(env['STUDIO_GAME_PORT'] ?? env['GAME_PORT'], DEFAULTS.gamePort),
    foundryPort: portFromEnv(env['STUDIO_FOUNDRY_PORT'] ?? env['FOUNDRY_PORT'], DEFAULTS.foundryPort),
    contentPort: portFromEnv(env['STUDIO_CONTENT_PORT'] ?? env['CONTENT_PORT'], DEFAULTS.contentPort),
    packDir: resolve(env['STUDIO_PACK_DIR'] ?? env['CONTENT_PACK_DIR'] ?? join(REPO_ROOT, 'content/dev-pack-v2')),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      values.help = true;
    } else if (argument === '--game-port') {
      values.gamePort = parsePort(argv[++index], '--game-port');
    } else if (argument === '--foundry-port') {
      values.foundryPort = parsePort(argv[++index], '--foundry-port');
    } else if (argument === '--content-port') {
      values.contentPort = parsePort(argv[++index], '--content-port');
    } else if (argument === '--pack-dir' || argument === '--content-dir' || argument === '--temp-content-dir') {
      const value = argv[++index];
      if (!value) {
        throw new Error(`${argument} requires a directory`);
      }
      values.packDir = resolve(value);
    } else if (argument?.startsWith('--game-port=')) {
      values.gamePort = parsePort(argument.slice('--game-port='.length), '--game-port');
    } else if (argument?.startsWith('--foundry-port=')) {
      values.foundryPort = parsePort(argument.slice('--foundry-port='.length), '--foundry-port');
    } else if (argument?.startsWith('--content-port=')) {
      values.contentPort = parsePort(argument.slice('--content-port='.length), '--content-port');
    } else if (argument?.startsWith('--pack-dir=') || argument?.startsWith('--content-dir=') || argument?.startsWith('--temp-content-dir=')) {
      const value = argument.slice(argument.indexOf('=') + 1);
      if (!value) {
        throw new Error(`${argument.slice(0, argument.indexOf('='))} requires a directory`);
      }
      values.packDir = resolve(value);
    } else {
      throw new Error(`unknown argument: ${argument ?? ''}`);
    }
  }
  return values;
}

function validatePorts(options) {
  const ports = [options.gamePort, options.foundryPort, options.contentPort];
  if (new Set(ports).size !== ports.length) {
    throw new Error('game, Foundry, and content ports must be different');
  }
}

function portFromEnv(value, fallback) {
  return value === undefined ? fallback : parsePort(value, 'environment port');
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer from 1 to 65535`);
  }
  return port;
}

function prefixStream(stream, name) {
  if (!stream) {
    return;
  }
  stream.setEncoding('utf8');
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        console.log(`[${name}] ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (pending.length > 0) {
      console.log(`[${name}] ${pending}`);
    }
  });
}

async function waitForHttp(url, name) {
  const deadline = Date.now() + 20000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`${name} did not become ready at ${url} (${lastError})`);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function stopChildren(records) {
  await Promise.all(records.map(async ({ name, child }) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.error(`Could not stop ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }));
  await delay(150);
  await Promise.all(records.map(async ({ name, child }) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.error(`Could not force-stop ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }));
}

function printUsage() {
  console.log('Usage: npm run dev:studio -- [options]');
  console.log('  --game-port <port>       game Vite port (default 5173)');
  console.log('  --foundry-port <port>    Foundry Vite port (default 5174)');
  console.log('  --content-port <port>    local content server port (default 8787)');
  console.log('  --pack-dir <directory>   content pack directory for Foundry writes');
  console.log('  --content-dir <directory> alias for --pack-dir');
  console.log('  --temp-content-dir <dir> alias for --pack-dir');
  console.log('Environment aliases: STUDIO_GAME_PORT, STUDIO_FOUNDRY_PORT, STUDIO_CONTENT_PORT, STUDIO_PACK_DIR');
  console.log('All services bind to 127.0.0.1. Ports are strict and cannot be shared.');
}

main().catch((error) => {
  console.error(`dev:studio failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
