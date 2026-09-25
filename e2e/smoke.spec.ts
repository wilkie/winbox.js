import { test, expect } from '@playwright/test';

/* Smoke coverage for the parts of the project that only exist in a browser:
 * the workspace mounts, the desktop paints, a window renders its chrome, and
 * dragging the title bar moves it.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#space .winbox')).toBeVisible();
});

test('mounts a workspace into the host element', async ({ page }) => {
  await expect(page.locator('#space .winbox')).toBeVisible();
});

test('paints the dithered desktop background', async ({ page }) => {
  const canvas = page.locator('#space > .winbox > canvas.__winbox_canvas');
  await expect(canvas).toBeAttached();

  const painted = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx || el.width === 0 || el.height === 0) {
      return false;
    }
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    return data.some((channel) => channel !== 0);
  });

  expect(painted).toBe(true);
});

test('renders window chrome for the demo window', async ({ page }) => {
  const demoWindow = page.locator('.__winbox_window-resizable').first();
  await expect(demoWindow).toBeVisible();

  await expect(demoWindow.locator('.__winbox_title-bar').first()).toBeVisible();
  await expect(demoWindow.locator('.__winbox_close-button').first()).toBeVisible();
  await expect(demoWindow.locator('.__winbox_minimize-button').first()).toBeVisible();
  await expect(demoWindow.locator('.__winbox_maximize-button').first()).toBeVisible();
});

test('gives the window resize handles on every edge', async ({ page }) => {
  const demoWindow = page.locator('.__winbox_window-resizable').first();

  for (const edge of ['top', 'bottom', 'left', 'right']) {
    await expect(demoWindow.locator(`.__winbox_resize-border_${edge}`).first()).toBeAttached();
  }
});

test('moves the window when its title bar is dragged', async ({ page }) => {
  const demoWindow = page.locator('.__winbox_window-resizable').first();
  const titleBar = demoWindow.locator('.__winbox_title-bar').first();

  const before = await demoWindow.boundingBox();
  const grip = await titleBar.boundingBox();
  expect(before).not.toBeNull();
  expect(grip).not.toBeNull();

  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 120, grip!.y + grip!.height / 2 + 80, {
    steps: 10,
  });
  await page.mouse.up();

  const after = await demoWindow.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x);
  expect(after!.y).toBeGreaterThan(before!.y);
});

test('loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  await page.reload();
  await expect(page.locator('#space .winbox')).toBeVisible();

  expect(errors).toEqual([]);
});

/* A window's pixels are palette indices, shown on its canvas by a presenter
 * once a frame. This draws a known pattern into a bitmap the size of a VGA
 * screen, presents it on a canvas, and reads the canvas back: the colours have
 * to come out of the palette in the byte order the canvas uses. It also says
 * how long a whole frame takes to present. */
test('presents a window bitmap on its canvas', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const host: any = globalThis;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    document.body.appendChild(canvas);
    const width = canvas.width;
    const height = canvas.height;
    const bitmap = new host.DeviceBitmap(width, height, 4);

    /* Red, green, blue and white stripes, eight columns each, in indices. */
    const stripes = [9, 10, 12, 15];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        bitmap.indices[y * width + x] = stripes[Math.floor(x / 8) % 4];
      }
    }

    const presenter = new host.Presenter(bitmap, canvas);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const ctx = canvas.getContext('2d')!;
    const at = (x: number) => Array.from(ctx.getImageData(x, 1, 1, 1).data);

    /* And how long one whole frame takes to present. */
    bitmap.context.markRect(0, 0, width, height);
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      bitmap.context.markRect(0, 0, width, height);
      presenter.present();
    }
    const perFrame = (performance.now() - start) / 20;

    return { colours: [at(0), at(8), at(16), at(24)], perFrame, width, height };
  });

  expect(result.colours).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
  ]);
  console.log(`present: ${result.width}x${result.height} in ${result.perFrame.toFixed(2)} ms`);
});
