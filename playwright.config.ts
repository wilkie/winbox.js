import { defineConfig, devices } from '@playwright/test';

/* End-to-end tests drive the demo page in `index.html` through the Vite dev
 * server. The windowing engine is the part of this project that only really
 * exists inside a browser, so it is tested in one rather than in jsdom.
 */

/* Headless Chromium kept off the desktop's display. Its GPU process loads
 * Vulkan for SwiftShader, and Mesa's device-select layer, installed with the
 * system's Vulkan, opens the display named by WAYLAND_DISPLAY or DISPLAY to
 * choose a device. Where that compositor takes connections but never answers
 * -- WSLg's Weston restarting after a crash, which it can do every hundred
 * seconds for hours -- the GPU process waits until the compositor dies, and
 * the page's first canvas draw (putImageData) blocks its main thread for up to
 * that long: the page froze after a drop, with nothing in the console. A
 * headless browser draws nothing on the desktop, so it is not told of one.
 */
const headless = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[0] !== 'WAYLAND_DISPLAY' && entry[0] !== 'DISPLAY' && entry[1] !== undefined
  )
);
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/warm.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { env: headless } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173/run.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
