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
  let rejectCancellation;
  let resolveLifecycle;
  const failurePromise = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  const cancellationPromise = new Promise((_, reject) => {
    rejectCancellation = reject;
  });
  const lifecyclePromise = new Promise((resolvePromise) => {
    resolveLifecycle = resolvePromise;
  });
  const readinessAbortController = new AbortController();

  const reportFailure = (error) => {
    if (firstFailure || stopping) {
      return;
    }
    firstFailure = error instanceof Error ? error : new Error(String(error));
    rejectFailure(firstFailure);
    resolveLifecycle();
  };

  const gameOrigin = `http://${LOOPBACK}:${options.gamePort}`;
  const contentOrigin = `http://${LOOPBACK}:${options.contentPort}`;
  const childEnv = {
    ...process.env,
    CONTENT_PACK_DIR: options.packDir,
    CONTENT_PORT: String(options.contentPort),
    STUDIO_CONTENT_PORT: String(options.contentPort),
    STUDIO_FOUNDRY_PORT: String(options.foundryPort),
    VITE_GAME_WEB_ORIGIN: gameOrigin,
    VITE_SANDBOX_PORT: String(options.gamePort),
    VITE_CONTENT_SERVER_URL: contentOrigin,
    VITE_CONTENT_SERVER_ORIGIN: contentOrigin,
    VITE_CONTENT_STATUS_URL: `${contentOrigin}/health`,
    VITE_CONTENT_HEALTH_URL: `${contentOrigin}/health`,
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
      readinessAbortController.abort();
      rejectCancellation(new Error('Studio shutdown requested'));
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
        waitForHttp(`${gameOrigin}/`, 'game', readinessAbortController.signal),
        waitForHttp(`http://${LOOPBACK}:${options.foundryPort}/`, 'foundry', readinessAbortController.signal),
        waitForHttp(`${contentOrigin}/health`, 'content', readinessAbortController.signal),
      ]),
      failurePromise,
      cancellationPromise,
    ]);

    if (firstFailure) {
      throw firstFailure;
    }

    console.log('Studio ready (loopback only)');
    console.log(`  Game:    ${gameOrigin}/?mode=interaction-lab&content=studio`);
    console.log(`  Foundry: http://${LOOPBACK}:${options.foundryPort}/`);
    console.log(`  Content: ${contentOrigin}/health`);
    console.log(`  Fixture: ${gameOrigin}/content/dev-pack-v2/pack.json`);
    console.log(`  Pack dir: ${options.packDir}`);
    console.log('Press Ctrl-C to stop the three owned services.');
    await lifecyclePromise;
    if (firstFailure) {
      console.error(`Studio stopped because a service failed: ${firstFailure.message}`);
      process.exitCode = 1;
    }
  } catch (error) {
    if (!stopping) {
      console.error(`Studio failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  } finally {
    stopping = true;
    readinessAbortController.abort();
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

async function waitForHttp(url, name, cancellationSignal) {
  const deadline = Date.now() + 20000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (cancellationSignal.aborted) {
      throw new Error('Studio shutdown requested');
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([cancellationSignal, AbortSignal.timeout(1200)]),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      if (cancellationSignal.aborted) {
        throw new Error('Studio shutdown requested');
      }
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
  await signalProcessGroups(records, 'SIGTERM');
  await waitForProcessGroups(records, 2000);
  const remaining = records.filter((record) => processGroupAlive(record));
  if (remaining.length > 0) {
    await signalProcessGroups(remaining, 'SIGKILL');
    await waitForProcessGroups(remaining, 2000);
  }
}

async function signalProcessGroups(records, signal) {
  await Promise.all(records.map(async ({ name, child }) => {
    try {
      if (child.pid) {
        process.kill(-child.pid, signal);
      } else if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.error(`Could not send ${signal} to ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }));
}

async function waitForProcessGroups(records, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && records.some((record) => processGroupAlive(record))) {
    await delay(25);
  }
}

function processGroupAlive({ child }) {
  if (!child.pid) {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
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
