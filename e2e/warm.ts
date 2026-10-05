import { chromium, type FullConfig } from '@playwright/test';

/* A fresh Vite server transforms the page's modules on their first request,
 * which can take longer than a test's thirty seconds; the first tests to load
 * the page then time out in `page.goto`. The page is loaded once here, with
 * time to spare, so every test meets a warm server.
 */
export default async function warm(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();

    await page.goto(`${baseURL}/run.html`, { waitUntil: 'load', timeout: 180_000 });
  } finally {
    await browser.close();
  }
}
