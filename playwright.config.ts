import { defineConfig, devices } from '@playwright/test';

const foundryPackDir = process.env['PLAYWRIGHT_CONTENT_PACK_DIR'] ?? process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e';
const gamePort = Number(process.env['PLAYWRIGHT_GAME_PORT'] ?? 4173);
const foundryPort = Number(process.env['PLAYWRIGHT_FOUNDRY_PORT'] ?? 4174);
const contentPort = Number(process.env['PLAYWRIGHT_CONTENT_PORT'] ?? process.env['CONTENT_PORT'] ?? 8787);
const serverMode = process.env['PLAYWRIGHT_SERVER_MODE'] === 'dev' ? 'dev' : 'preview';
const skipContentServer = process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1';
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const configuredGameOrigin = process.env['PLAYWRIGHT_GAME_WEB_ORIGIN'];
const gameOrigin = configuredGameOrigin ?? `http://127.0.0.1:${String(gamePort)}`;
process.env['PLAYWRIGHT_GAME_WEB_ORIGIN'] = gameOrigin;
const configuredIgnoreDefaultArgs = process.env['PLAYWRIGHT_IGNORE_DEFAULT_ARGS'];
const ignoreDefaultArgs = configuredIgnoreDefaultArgs
  ? configuredIgnoreDefaultArgs.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
  : undefined;

process.env['CONTENT_PACK_DIR'] = foundryPackDir;
process.env['CONTENT_PORT'] = String(contentPort);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const gameCommand = serverMode === 'dev'
  ? `npm run dev --workspace @pastel-rts/game-web -- --host 127.0.0.1 --port ${String(gamePort)} --strictPort`
  : `npm run preview --workspace @pastel-rts/game-web -- --host 127.0.0.1 --port ${String(gamePort)} --strictPort`;
const foundryCommand = `${gameOrigin ? `VITE_GAME_WEB_ORIGIN=${shellQuote(gameOrigin)} ` : ''}${serverMode === 'dev'
  ? `npm run dev --workspace @pastel-rts/foundry -- --host 127.0.0.1 --port ${String(foundryPort)} --strictPort`
  : `npm run preview --workspace @pastel-rts/foundry -- --host 127.0.0.1 --port ${String(foundryPort)} --strictPort`}`;
const browserLaunchOptions = {
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  ...(ignoreDefaultArgs ? { ignoreDefaultArgs } : {}),
};

export default defineConfig({
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      threshold: 0.12,
      animations: 'disabled',
    },
  },
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    trace: 'on-first-retry',
    launchOptions: browserLaunchOptions,
  },
  projects: [
    {
      name: 'chromium',
      testDir: './apps/game-web/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(gamePort)}`,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'foundry',
      testDir: './apps/foundry/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(foundryPort)}`,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: [
    {
      command: gameCommand,
      url: `http://127.0.0.1:${String(gamePort)}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(skipContentServer
      ? []
      : [{
          command: `mkdir -p ${shellQuote(foundryPackDir)} && CONTENT_PACK_DIR=${shellQuote(foundryPackDir)} CONTENT_PORT=${String(contentPort)} npm run start --workspace @pastel-rts/content-server`,
          url: `http://127.0.0.1:${String(contentPort)}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            CONTENT_PACK_DIR: foundryPackDir,
            CONTENT_PORT: String(contentPort),
          },
        }]),
    {
      command: foundryCommand,
      url: `http://127.0.0.1:${String(foundryPort)}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
