import type { Page } from '@playwright/test';

/**
 * Keep the product Vite proxy untouched while routing test traffic to the
 * isolated content server. Playwright changes only the browser request URL;
 * production and the default root configuration keep their original paths.
 */
export async function routeIsolatedContent(page: Page): Promise<void> {
  const port = Number(process.env['CONTENT_PORT'] ?? 8787);
  if (port === 8787) {
    return;
  }
  await page.route('**/dev-content**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.pathname.startsWith('/dev-content')) {
      await route.continue();
      return;
    }
    const targetUrl = new URL(`http://127.0.0.1:${String(port)}`);
    targetUrl.pathname = requestUrl.pathname.replace(/^\/dev-content(?=\/|$)/, '') || '/';
    targetUrl.search = requestUrl.search;
    await route.continue({ url: targetUrl.toString() });
  });
}
