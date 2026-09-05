import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

export type BrowserErrorRecord = {
  kind: 'console' | 'pageerror' | 'requestfailed' | 'http';
  type?: string;
  text?: string;
  url?: string;
  status?: number;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
};

export type BrowserEvidenceCapture = {
  screenshotPath: string;
  sidecarPath: string;
};

type RuntimeSnapshot = {
  url: string;
  title: string;
  canvasCount: number;
  canvases: Array<{ width: number; height: number; cssWidth: number; cssHeight: number }>;
  webglRenderer: string | null;
  bodyText: string;
};

/** Collects browser diagnostics and composited screenshots for one test page. */
export function observeBrowser(page: Page, testInfo: TestInfo, label: string): {
  capture: (stage: string, metadata?: Record<string, unknown>) => Promise<BrowserEvidenceCapture>;
} {
  const errors: BrowserErrorRecord[] = [];
  page.on('console', (message) => {
    errors.push({
      kind: 'console',
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });
  page.on('pageerror', (error) => {
    errors.push({ kind: 'pageerror', text: error.message });
  });
  page.on('requestfailed', (request) => {
    errors.push({ kind: 'requestfailed', text: request.failure()?.errorText, url: request.url() });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push({ kind: 'http', status: response.status(), url: response.url() });
    }
  });

  return {
    capture: async (stage, metadata = {}) => {
      const artifactDir = resolve(
        process.env['M11C_ARTIFACT_DIR'] ?? join(process.cwd(), 'docs/roadmap/M1.1-C-artifacts'),
      );
      mkdirSync(artifactDir, { recursive: true });
      const stem = [testInfo.project.name, label, stage]
        .join('-')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 180);
      const screenshotPath = join(artifactDir, `${stem}.png`);
      const sidecarPath = join(artifactDir, `${stem}.json`);
      await page.screenshot({ path: screenshotPath });
      const runtime = await readRuntimeSnapshot(page);
      writeFileSync(
        sidecarPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            label,
            stage,
            project: testInfo.project.name,
            testTitle: testInfo.title,
            screenshotPath,
            capturedAt: new Date().toISOString(),
            runtime,
            metadata,
            browserDiagnostics: [...errors],
          },
          null,
          2,
        ),
        'utf8',
      );
      return { screenshotPath, sidecarPath };
    },
  };
}

async function readRuntimeSnapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    });
    const primary = document.querySelector('canvas');
    let webglRenderer: string | null = null;
    if (primary instanceof HTMLCanvasElement) {
      const gl = primary.getContext('webgl2') ?? primary.getContext('webgl');
      const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
      if (gl && debugInfo) {
        webglRenderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      }
    }
    return {
      url: window.location.href,
      title: document.title,
      canvasCount: canvases.length,
      canvases,
      webglRenderer,
      bodyText: (document.body.innerText ?? '').slice(0, 4000),
    };
  });
}
