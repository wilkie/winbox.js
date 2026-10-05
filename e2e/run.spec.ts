import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';

/* The page for running Windows programs: archives in, programs listed, a
 * program run, its calls traced. The archives are built here, byte by byte and
 * stored rather than compressed, and handed to the page's file picker, which is
 * what a drop reaches too. */

function archive(files: { path: string; data: Uint8Array }[]) {
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const u32 = (value: number) => [...u16(value & 0xffff), ...u16((value >>> 16) & 0xffff)];
  const locals: number[] = [];
  const central: number[] = [];

  for (const file of files) {
    const name = Array.from(file.path, (character) => character.charCodeAt(0));
    const offset = locals.length;

    locals.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u32(0), ...u32(0));
    locals.push(...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0));
    locals.push(...name);

    // A byte at a time: spread, a program's worth of bytes overflows the stack.
    for (const byte of file.data) {
      locals.push(byte);
    }

    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u32(0));
    central.push(...u32(0), ...u32(file.data.length), ...u32(file.data.length));
    central.push(...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0));
    central.push(...u32(offset), ...name);
  }

  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(central.length),
    ...u32(locals.length),
    ...u16(0),
  ];

  return Buffer.from([...locals, ...central, ...end]);
}

/* A Windows program's first bytes: an MZ stub pointing at an NE header. */
function windowsHeader() {
  const data = new Uint8Array(0x60);
  data.set([0x4d, 0x5a]);
  data[0x3c] = 0x40;
  data.set([0x4e, 0x45], 0x40);
  return data;
}

/* A real Windows program, where the oracle has built one: the `strings` probe,
 * which needs no fonts. It is not committed, so this runs only where the
 * pipeline has been run. */
const STRINGS = join(process.cwd(), 'oracle', 'build', 'probes', 'STRINGS.EXE');

const DRIVE_C = join(process.cwd(), 'oracle', 'build', 'drive-c', 'WINDOWS');
const CHROME = join(process.cwd(), 'oracle', 'build', 'probes', 'CHROME.EXE');

/* Notepad, from the installation, as a screen reader is given it: the mirror
 * of USER's windows beside the canvas, and the keyboard's place in it. */
const NOTEPAD = join(DRIVE_C, 'NOTEPAD.EXE');

/* Clock, closed with Alt+F4: its timer stopped, its window gone, and the
 * program ended through DOS. */
const CLOCK = join(DRIVE_C, 'CLOCK.EXE');

/* The `sndplay` probe, which asks for the sound Windows starts with, the
 * `SystemStart` of WIN.INI's [Sounds]: TADA.WAV, made here, as the oracle's
 * installation has none. */
const SNDPLAY = join(process.cwd(), 'oracle', 'build', 'probes', 'SNDPLAY.EXE');

/* Half a second of 440 Hz at 11,025 samples a second, as an 8-bit wave file. */
function tone() {
  const count = 5512;
  const data = new Uint8Array(44 + count);
  const view = new DataView(data.buffer);
  const text = (at: number, value: string) =>
    Array.from(value, (character, i) => data.set([character.charCodeAt(0)], at + i));

  text(0, 'RIFF');
  view.setUint32(4, 36 + count, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 11025, true);
  view.setUint32(28, 11025, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, count, true);

  for (let i = 0; i < count; i++) {
    data[44 + i] = 128 + Math.round(100 * Math.sin((2 * Math.PI * 440 * i) / 11025));
  }

  return data;
}

/* The Rust engine's module, which `pnpm build:web` builds and nothing commits. */
const RUST = join(process.cwd(), 'target', 'winbox-web', 'winbox_web_bg.wasm');

/* Each test on each engine: the TypeScript engine, the page's own, and the
 * Rust engine built for WebAssembly, at `run.html?engine=rust`. */
const ENGINES = [
  { engine: 'ts', page: '/run.html' },
  { engine: 'rust', page: '/run.html?engine=rust' },
] as const;

for (const { engine, page: at } of ENGINES) {
  test.describe(`on the ${engine} engine`, () => {
    test.skip(
      engine === 'rust' && !existsSync(RUST),
      'the Rust engine has not been built: pnpm build:web'
    );

    test('lists the programs in a dropped archive, on C: as 8.3 names', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(page.locator('#windows')).toContainText('No Windows installation');

      await page.locator('#picker').setInputFiles({
        name: 'Games.zip',
        mimeType: 'application/zip',
        buffer: archive([
          { path: 'SKI.EXE', data: windowsHeader() },
          { path: 'Long File Name.txt', data: new Uint8Array([1, 2, 3]) },
        ]),
      });

      await expect(page.locator('#programs li')).toHaveCount(1);
      await expect(page.locator('#programs li code')).toHaveText('C:\\GAMES\\SKI.EXE');
      await expect(page.locator('#files')).toContainText('C:\\GAMES\\LONGFI~1.TXT');
      expect(errors).toEqual([]);
    });

    test('runs a real Windows program and traces its calls', async ({ page }) => {
      test.skip(!existsSync(STRINGS), 'the strings probe has not been built here');

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');

      await page.locator('#picker').setInputFiles({
        name: 'probes.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'STRINGS.EXE', data: new Uint8Array(readFileSync(STRINGS)) }]),
      });

      await page.getByRole('button', { name: 'Run C:\\PROBES\\STRINGS.EXE' }).click();

      await expect(page.locator('#counts')).toContainText('KERNEL.lstrlen', { timeout: 15000 });
      await expect(page.locator('#counts')).toContainText('USER.lstrcmp');
    });

    test("draws a real program's windows on the raster screen, from the installation's driver", async ({
      page,
    }) => {
      test.skip(
        !existsSync(CHROME) || !existsSync(DRIVE_C),
        'the oracle pipeline has not run here'
      );

      /* An installation of just what the screen needs: SYSTEM.INI, which names
       * the display driver, the driver, and the fonts. */
      const system = join(DRIVE_C, 'SYSTEM');
      const files = [
        {
          path: 'WINDOWS/SYSTEM.INI',
          data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))),
        },
        ...readdirSync(system)
          .filter((name: string) => /\.(FON|DRV)$/i.test(name))
          .map((name: string) => ({
            path: `WINDOWS/SYSTEM/${name}`,
            data: new Uint8Array(readFileSync(join(system, name))),
          })),
      ];

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');

      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(files),
      });
      await expect(page.locator('#windows')).toContainText('win31.zip');

      await page.locator('#picker').setInputFiles({
        name: 'probes.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'CHROME.EXE', data: new Uint8Array(readFileSync(CHROME)) }]),
      });

      const screen = page.getByRole('img', { name: 'The Windows screen' });

      await expect(screen).toBeVisible();

      /* The desktop takes the keyboard when the screen is pressed, as Windows' input. */
      await screen.click({ position: { x: 10, y: 10 } });
      await expect(page.getByRole('application', { name: 'Windows desktop' })).toBeFocused();

      await page.getByRole('button', { name: 'Run C:\\PROBES\\CHROME.EXE' }).click();

      await expect(page.locator('#counts')).toContainText('USER.CreateWindow', { timeout: 20000 });
      await expect(page.locator('#counts')).toContainText('USER.ShowWindow');
      await expect(page.locator('#status')).not.toContainText('stopped');

      /* Past its message pump, which once waited on an empty queue, to reading the
       * window back from the screen. */
      await expect(page.locator('#counts')).toContainText('USER.GetWindowRect', { timeout: 20000 });
      await expect(page.locator('#counts')).toContainText('GDI.GetPixel');
    });

    test('mirrors Notepad for a screen reader, its menu opened from the keyboard', async ({
      page,
    }) => {
      test.skip(!existsSync(NOTEPAD), 'the oracle pipeline has not run here');

      const system = join(DRIVE_C, 'SYSTEM');
      const files = [
        {
          path: 'WINDOWS/SYSTEM.INI',
          data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))),
        },
        { path: 'WINDOWS/WIN.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'WIN.INI'))) },
        ...readdirSync(system)
          .filter((name: string) => /\.(FON|DRV)$|^USER\.EXE$/i.test(name))
          .map((name: string) => ({
            path: `WINDOWS/SYSTEM/${name}`,
            data: new Uint8Array(readFileSync(join(system, name))),
          })),
      ];

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(files),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'NOTEPAD.EXE', data: new Uint8Array(readFileSync(NOTEPAD)) }]),
      });
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();

      const window = page.getByRole('group', { name: 'Notepad - (Untitled)' });

      await expect(window).toHaveCount(1, { timeout: 20000 });
      await expect(window).toHaveAttribute('aria-description', 'active');
      const bar = window.getByRole('menubar').getByRole('menuitem');

      await expect(bar).toHaveCount(4);
      expect(
        await bar.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
      ).toEqual(['File', 'Edit', 'Search', 'Help']);
      await expect(window.getByRole('textbox')).toHaveCount(1);

      /* Alt and F, as a keyboard user opens a menu: the reader is pointed at the
       * menu's first item. */
      const desktop = page.getByRole('application', { name: 'Windows desktop' });

      /* On Notepad's caption. Notepad asks for CW_USEDEFAULT, and the first
       * such window goes at the screen's corner, (0,0) to (636,408) on the
       * VGA, as `usedef` recorded it: the caption is across the top, the menu
       * bar under it, File at its left. (The middle of the screen, where these
       * clicks went before, was a guess at a 400 by 300 window centred.) */
      const screen = page.getByRole('img', { name: 'The Windows screen' });
      const box = (await screen.boundingBox())!;

      await screen.click({ position: { x: box.width / 2, y: (12 * box.height) / 480 } });
      await expect(desktop).toBeFocused();
      const file = window.getByRole('menuitem', { name: 'File', exact: true });

      /* Pressed and released on File, as a mouse user opens a menu: it stays
       * open, and the reader is pointed at File. */
      await screen.click({ position: { x: (24 * box.width) / 640, y: (32 * box.height) / 480 } });
      await expect(file).toHaveAttribute('aria-expanded', 'true');
      await expect(desktop).toHaveAttribute(
        'aria-activedescendant',
        (await file.getAttribute('id'))!
      );

      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(file).toHaveAttribute('aria-expanded', 'false');

      await page.keyboard.press('Alt+f');

      await expect(file).toHaveAttribute('aria-expanded', 'true');

      const first = file.getByRole('menu').getByRole('menuitem').first();

      await expect(first).toHaveAttribute('aria-label', 'New');
      await expect(desktop).toHaveAttribute(
        'aria-activedescendant',
        (await first.getAttribute('id'))!
      );

      /* Exit, from the menu: Notepad closes its window, its message loop ends,
       * and it returns to DOS -- its window gone, and the page told. */
      await page.keyboard.press('x');
      await expect(page.locator('#status')).toHaveText('The program has ended, with exit code 0.', {
        timeout: 20000,
      });
      await expect(window).toHaveCount(0);
    });

    test('closes Clock with Alt+F4, and the program ends', async ({ page }) => {
      test.skip(!existsSync(CLOCK), 'the oracle pipeline has not run here');

      const system = join(DRIVE_C, 'SYSTEM');
      const files = [
        {
          path: 'WINDOWS/SYSTEM.INI',
          data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))),
        },
        { path: 'WINDOWS/WIN.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'WIN.INI'))) },
        ...readdirSync(system)
          .filter((name: string) => /\.(FON|DRV)$|^USER\.EXE$/i.test(name))
          .map((name: string) => ({
            path: `WINDOWS/SYSTEM/${name}`,
            data: new Uint8Array(readFileSync(join(system, name))),
          })),
      ];

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(files),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'CLOCK.EXE', data: new Uint8Array(readFileSync(CLOCK)) }]),
      });
      await page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' }).click();

      const window = page.getByRole('group', { name: 'Clock' });

      await expect(window).toHaveCount(1, { timeout: 20000 });

      const screen = page.getByRole('img', { name: 'The Windows screen' });
      const box = (await screen.boundingBox())!;

      /* On Clock's caption. With no CLOCK.INI to say where, it goes at the
       * screen's corner, where the first window placed at CW_USEDEFAULT goes
       * (`usedef`); the middle of the screen, where this click went before,
       * is the desktop. */
      await screen.click({ position: { x: (104 * box.width) / 640, y: (12 * box.height) / 480 } });
      await page.keyboard.press('Alt+F4');

      await expect(page.locator('#status')).toHaveText(/^The program has ended/, {
        timeout: 20000,
      });
      await expect(window).toHaveCount(0);

      /* And it runs again, as after any program that ended properly. */
      await page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' }).click();
      await expect(window).toHaveCount(1, { timeout: 20000 });
      await expect(page.locator('#status')).toHaveText('C:\\APPS\\CLOCK.EXE is running.');
    });

    test('runs Clock and Notepad beside one another, and one closed leaves the others running', async ({
      page,
    }) => {
      test.skip(!existsSync(CLOCK) || !existsSync(NOTEPAD), 'the oracle pipeline has not run here');

      const system = join(DRIVE_C, 'SYSTEM');
      const files = [
        {
          path: 'WINDOWS/SYSTEM.INI',
          data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))),
        },
        { path: 'WINDOWS/WIN.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'WIN.INI'))) },
        ...readdirSync(system)
          .filter((name: string) => /\.(FON|DRV)$|^USER\.EXE$/i.test(name))
          .map((name: string) => ({
            path: `WINDOWS/SYSTEM/${name}`,
            data: new Uint8Array(readFileSync(join(system, name))),
          })),
      ];

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(files),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([
          { path: 'CLOCK.EXE', data: new Uint8Array(readFileSync(CLOCK)) },
          { path: 'NOTEPAD.EXE', data: new Uint8Array(readFileSync(NOTEPAD)) },
        ]),
      });

      const clock = page.getByRole('group', { name: 'Clock' });
      const notepad = page.getByRole('group', { name: 'Notepad - (Untitled)' });

      await page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' }).click();
      await expect(clock).toHaveCount(1, { timeout: 20000 });

      /* Notepad, beside Clock on the one desktop; and Notepad again, a second
       * instance, given the first as its previous one. */
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();
      await expect(notepad).toHaveCount(1, { timeout: 20000 });
      await expect(page.locator('#status')).toHaveText('C:\\APPS\\NOTEPAD.EXE is running.');
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();
      await expect(notepad).toHaveCount(2, { timeout: 20000 });
      await expect(clock).toHaveCount(1);

      /* Clock made active on its caption, at the screen's corner, above the
       * Notepads placed after it (`usedef`), and closed with Alt+F4: it ends,
       * and is told, and the Notepads run on. */
      const status = page.locator('#status');
      const screen = page.getByRole('img', { name: 'The Windows screen' });
      const box = (await screen.boundingBox())!;

      await screen.click({ position: { x: (104 * box.width) / 640, y: (12 * box.height) / 480 } });
      await expect(clock).toHaveAttribute('aria-description', 'active');
      await page.keyboard.press('Alt+F4');
      await expect(clock).toHaveCount(0, { timeout: 20000 });
      await expect(status).toHaveText('The program has ended, with exit code 0.');
      await expect(notepad).toHaveCount(2);

      /* Each Notepad, made active as the window before it goes, is closed
       * from the keyboard, the last ending the run: the first with Alt+F4,
       * which its edit box, having the focus, passes to `DefWindowProc` and
       * USER posts as Close to the active window (`altchild`); the second
       * exits from its menu. */
      for (const left of [1, 0]) {
        await status.evaluate((line) => (line.textContent = ''));
        await expect(notepad.and(page.locator('[aria-description="active"]'))).toHaveCount(1);

        if (left === 1) {
          await page.keyboard.press('Alt+F4');
        } else {
          await page.keyboard.press('Alt+f');
          await page.keyboard.press('x');
        }

        await expect(notepad).toHaveCount(left, { timeout: 20000 });
        await expect(status).toHaveText('The program has ended, with exit code 0.');
      }
    });

    test('sounds what the sound card plays, with Sound ticked', async ({ page }) => {
      test.skip(engine !== 'rust', 'only the Rust engine has a sound card');
      test.skip(
        !existsSync(SNDPLAY) || !existsSync(DRIVE_C),
        'the oracle pipeline has not run here'
      );

      /* Web Audio stood in for: each buffer made kept, with its rate, its
       * length and its loudest sample, and when each was started. */
      await page.addInitScript(() => {
        const heard = {
          buffers: [] as { rate: number; length: number; peak: number }[],
          started: [] as number[],
        };

        class Context {
          state = 'suspended';
          sampleRate = 48000;
          destination = {};
          from = performance.now();

          get currentTime() {
            return (performance.now() - this.from) / 1000;
          }

          resume() {
            this.state = 'running';
            return Promise.resolve();
          }

          createBuffer(channels: number, length: number, rate: number) {
            const kept = { rate, length, peak: 0 };

            heard.buffers.push(kept);
            return {
              length,
              sampleRate: rate,
              copyToChannel(samples: Float32Array) {
                for (const sample of samples) {
                  kept.peak = Math.max(kept.peak, Math.abs(sample));
                }
              },
            };
          }

          createBufferSource() {
            return {
              buffer: null,
              onended: null,
              connect() {},
              start(when: number) {
                heard.started.push(when);
              },
              stop() {},
            };
          }
        }

        Object.assign(globalThis, { AudioContext: Context, heard });
      });

      const system = join(DRIVE_C, 'SYSTEM');
      const files = [
        {
          path: 'WINDOWS/SYSTEM.INI',
          data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))),
        },
        { path: 'WINDOWS/WIN.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'WIN.INI'))) },
        { path: 'WINDOWS/TADA.WAV', data: tone() },
        ...readdirSync(system)
          .filter((name: string) => /\.(FON|DRV)$|^USER\.EXE$/i.test(name))
          .map((name: string) => ({
            path: `WINDOWS/SYSTEM/${name}`,
            data: new Uint8Array(readFileSync(join(system, name))),
          })),
      ];

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(files),
      });
      await page.locator('#picker').setInputFiles({
        name: 'probes.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'SNDPLAY.EXE', data: new Uint8Array(readFileSync(SNDPLAY)) }]),
      });

      await page.getByRole('checkbox', { name: 'Sound' }).check();
      await page.getByRole('button', { name: 'Run C:\\PROBES\\SNDPLAY.EXE' }).click();

      /* The tone, heard: half a second, three halves of the card's buffer
       * at its rate, 11,111 a second for the file's 11,025, loud where the
       * tone is; each started as long after the last as the card played it,
       * or later, where the speaker had to begin afresh. */
      await page.waitForFunction(
        () =>
          (globalThis as any).heard.buffers.filter((buffer: any) => buffer.peak > 0.5).length >= 3,
        null,
        { timeout: 20000 }
      );

      const heard = await page.evaluate(() => (globalThis as any).heard);
      const loud = heard.buffers.filter((buffer: any) => buffer.peak > 0.5);

      expect(heard.started).toHaveLength(heard.buffers.length);
      expect(loud.reduce((sum: number, buffer: any) => sum + buffer.length, 0)).toBeGreaterThan(
        5512
      );

      for (let i = 1; i < heard.started.length; i++) {
        expect(heard.started[i] - heard.started[i - 1]).toBeGreaterThan(
          (0.99 * heard.buffers[i - 1].length) / heard.buffers[i - 1].rate
        );
      }

      for (const buffer of heard.buffers) {
        expect(buffer.rate).toBeGreaterThanOrEqual(4000);
        expect(buffer.rate).toBeLessThanOrEqual(48000);
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.length).toBeLessThan(buffer.rate);
      }

      expect(heard.buffers.some((buffer: any) => Math.abs(buffer.rate - 11111) < 1)).toBe(true);
      expect(Math.max(...heard.buffers.map((buffer: any) => buffer.peak))).toBeCloseTo(
        100 / 128,
        1
      );
    });

    test('has no Sound to tick on the TypeScript engine', async ({ page }) => {
      test.skip(engine !== 'ts', 'the Rust engine has one');

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(page.getByRole('checkbox', { name: 'Sound' })).toBeHidden();
    });
  });
}

/* The screen's pixels are palette indices, shown on its canvas by a presenter
 * once a frame. This draws a known pattern into a bitmap the size of a VGA
 * screen, presents it on a canvas, and reads the canvas back: the colours have
 * to come out of the palette in the byte order the canvas uses. It also says
 * how long a whole frame takes to present. */
test('presents a screen bitmap on its canvas', async ({ page }) => {
  await page.goto('/run.html');
  await expect(page.locator('#status')).toHaveText('Ready.');

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
