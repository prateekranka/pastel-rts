import { defineConfig, devices } from '@playwright/test';

const foundryPackDir = process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e';
process.env['CONTENT_PACK_DIR'] = foundryPackDir;

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
  },
  projects: [
    {
      name: 'chromium',
      testDir: './apps/game-web/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'foundry',
      testDir: './apps/foundry/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: [
    {
      command: 'npm run preview --workspace @pastel-rts/game-web -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: `mkdir -p "${foundryPackDir}" && npm run start --workspace @pastel-rts/content-server`,
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        CONTENT_PACK_DIR: foundryPackDir,
      },
    },
    {
      command: 'npm run preview --workspace @pastel-rts/foundry -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
