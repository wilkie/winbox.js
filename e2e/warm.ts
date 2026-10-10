import { chromium, type FullConfig } from '@playwright/test';

/* A fresh Vite server transforms the page's modules on their first request,
 * which can take longer than a test's thirty seconds; the first tests to load
 * the page then time out in `page.goto`. The page is loaded once here, with
 * time to spare, so every test meets a warm server: on each engine, as the
 * page's own (the Rust engine's) loads none of the TypeScript engine's.
 */
export default async function warm(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch(config.projects[0]?.use.launchOptions);

  try {
    const page = await browser.newPage();

    for (const at of ['/run.html', '/run.html?engine=ts']) {
      await page.goto(`${baseURL}${at}`, { waitUntil: 'load', timeout: 180_000 });
      await page.locator('#status').filter({ hasText: 'Ready.' }).waitFor({ timeout: 180_000 });
    }
  } finally {
    await browser.close();
  }
}
