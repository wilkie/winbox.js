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

/* The `fault` probe, which starts a program of its own, FAULTC.EXE, and has
 * it fault: KERNEL's boxes, answered with Enter, end it with 255. */
const FAULT = join(process.cwd(), 'oracle', 'build', 'probes', 'FAULT.EXE');
const FAULTC = join(process.cwd(), 'oracle', 'build', 'probes', 'FAULTC.EXE');

/* The installation's files a program's windows are drawn from: SYSTEM.INI
 * and WIN.INI, the display driver and the fonts, and USER. */
function installation() {
  const system = join(DRIVE_C, 'SYSTEM');

  return [
    { path: 'WINDOWS/SYSTEM.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))) },
    { path: 'WINDOWS/WIN.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'WIN.INI'))) },
    ...readdirSync(system)
      .filter((name: string) => /\.(FON|DRV)$|^USER\.EXE$/i.test(name))
      .map((name: string) => ({
        path: `WINDOWS/SYSTEM/${name}`,
        data: new Uint8Array(readFileSync(join(system, name))),
      })),
  ];
}

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

/* The `adlibmap` probe, which plays MIDI through the MIDI Mapper to the
 * synthesizer: what the page hears of it is the FM chip's sound. */
const ADLIBMAP = join(process.cwd(), 'oracle', 'build', 'probes', 'ADLIBMAP.EXE');

/* Web Audio stood in for, as a page's init script: each buffer made kept,
 * with its rate, its length and its loudest sample, and when each was
 * started, with its buffer's rate. */
function standInForWebAudio() {
  const heard = {
    buffers: [] as { rate: number; length: number; peak: number }[],
    started: [] as { when: number; rate: number }[],
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
      const source = {
        buffer: null as { sampleRate: number } | null,
        onended: null,
        connect() {},
        start(when: number) {
          heard.started.push({ when, rate: source.buffer?.sampleRate ?? 0 });
        },
        stop() {},
      };

      return source;
    }
  }

  Object.assign(globalThis, { AudioContext: Context, heard });
}

/* The installation as the sound tests give it: SYSTEM.INI and WIN.INI, the
 * drivers and fonts, and USER. */
function soundInstallation() {
  const system = join(DRIVE_C, 'SYSTEM');

  return [
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
}

/* Each test on each engine: the TypeScript engine, at `run.html?engine=ts`,
 * and the Rust engine built for WebAssembly, the page's own. */
const ENGINES = [
  { engine: 'ts', page: '/run.html?engine=ts' },
  { engine: 'rust', page: '/run.html' },
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
       * open, and letting go where it was pressed selects its first item, as
       * Windows does (`mdisys`), at which the reader is pointed. */
      await screen.click({ position: { x: (24 * box.width) / 640, y: (32 * box.height) / 480 } });
      await expect(file).toHaveAttribute('aria-expanded', 'true');

      const opened = file.getByRole('menu').getByRole('menuitem').first();

      await expect(opened).toHaveAttribute('aria-label', 'New');
      await expect(desktop).toHaveAttribute(
        'aria-activedescendant',
        (await opened.getAttribute('id'))!
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

    test('moves Notepad dragged by its caption, drawn where it was let go', async ({ page }) => {
      test.skip(!existsSync(NOTEPAD), 'the oracle pipeline has not run here');

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(installation()),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'NOTEPAD.EXE', data: new Uint8Array(readFileSync(NOTEPAD)) }]),
      });
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();
      await expect(page.getByRole('group', { name: 'Notepad - (Untitled)' })).toHaveCount(1, {
        timeout: 20000,
      });

      const screen = page.getByRole('img', { name: 'The Windows screen' });

      /* All of it in view, where the mouse can reach it. */
      await screen.scrollIntoViewIfNeeded();

      const box = (await screen.boundingBox())!;
      const on = (x: number, y: number) => [
        box.x + (x * box.width) / 640,
        box.y + (y * box.height) / 480,
      ];
      /* A pixel of the screen as its canvas shows it. */
      const pixel = (x: number, y: number) =>
        screen.evaluate(
          (canvas: HTMLCanvasElement, [px, py]) =>
            Array.from(canvas.getContext('2d')!.getImageData(px, py, 1, 1).data),
          [x, y]
        );
      const white = [255, 255, 255, 255];

      /* Notepad at the screen's corner, (0,0) to (636,408) on the VGA
       * (`usedef`): its client area white, the desktop below it. */
      await expect.poll(() => pixel(300, 200), { timeout: 20000 }).toEqual(white);

      const desktop = await pixel(5, 470);

      expect(desktop).not.toEqual(white);
      expect(await pixel(300, 450)).toEqual(desktop);

      /* Its caption pressed, dragged 100 across and 80 down, and let go, a
       * person's pace: the move and size loop starts once the press is
       * taken. */
      await page.mouse.move(...(on(300, 10) as [number, number]));
      await page.mouse.down();
      await page.waitForTimeout(300);

      for (let step = 1; step <= 10; step++) {
        await page.mouse.move(...(on(300 + step * 10, 10 + step * 8) as [number, number]));
        await page.waitForTimeout(30);
      }

      await page.waitForTimeout(300);
      await page.mouse.up();

      /* At its new place, (100,80) on, it shows whole -- its client area
       * white where the desktop was -- and where it was and is no more, the
       * desktop. Windows takes its bits with it (`swpbits`); the engines
       * once painted it only where it had been. */
      await expect.poll(() => pixel(300, 450), { timeout: 20000 }).toEqual(white);
      await expect.poll(() => pixel(600, 450)).toEqual(white);
      expect(await pixel(50, 200)).toEqual(desktop);
      expect(await pixel(300, 40)).toEqual(desktop);
      expect(await pixel(300, 200)).toEqual(white);
    });

    test("opens a file from Notepad's File Open, a directory double-clicked and a file picked", async ({
      page,
    }) => {
      const commdlg = join(DRIVE_C, 'SYSTEM', 'COMMDLG.DLL');

      test.skip(
        !existsSync(NOTEPAD) || !existsSync(commdlg),
        'the oracle pipeline has not run here'
      );

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive([
          ...installation(),
          { path: 'WINDOWS/SYSTEM/COMMDLG.DLL', data: new Uint8Array(readFileSync(commdlg)) },
        ]),
      });
      /* Notepad in C:\APPS, and a text file in a folder beside it. */
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([
          { path: 'NOTEPAD.EXE', data: new Uint8Array(readFileSync(NOTEPAD)) },
          { path: 'DOCS/NOTE.TXT', data: new Uint8Array([0x68, 0x69]) },
        ]),
      });
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();
      await expect(page.getByRole('group', { name: 'Notepad - (Untitled)' })).toHaveCount(1, {
        timeout: 20000,
      });

      const screen = page.getByRole('img', { name: 'The Windows screen' });

      await screen.scrollIntoViewIfNeeded();

      const box = (await screen.boundingBox())!;
      const on = (x: number, y: number) =>
        [box.x + ((x + 0.5) * box.width) / 640, box.y + ((y + 0.5) * box.height) / 480] as [
          number,
          number,
        ];

      /* File, then Open, from the keyboard; the screen pressed first, so the
       * desktop has the keys. */
      await screen.click({ position: { x: box.width / 2, y: (12 * box.height) / 480 } });
      await page.keyboard.press('Alt+f');
      await page.keyboard.press('o');

      const open = page.getByRole('group', { name: 'Open' });

      await expect(open).toHaveCount(1, { timeout: 20000 });
      await expect(open.getByText('c:\\apps', { exact: true })).toHaveCount(1);

      /* The dialog at (64,57) on the VGA: the directories' rows 16 high from
       * 133, `c:\`, `apps`, `docs`; the files' 13 high from 133. `docs`
       * double-clicked is gone into. */
      await page.mouse.dblclick(...on(300, 173));
      await expect(open.getByText('c:\\apps\\docs', { exact: true })).toHaveCount(1, {
        timeout: 20000,
      });

      const files = open.getByRole('listbox').first();

      await expect(files.getByRole('option')).toHaveCount(1);
      await expect(files.getByRole('option')).toHaveAttribute('aria-label', 'NOTE.TXT');

      /* The file clicked gives the name its edit; OK opens it. */
      await page.mouse.click(...on(110, 139));
      await expect(open.getByRole('textbox')).toHaveText('note.txt', { timeout: 20000 });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('group', { name: 'Notepad - NOTE.TXT' })).toHaveCount(1, {
        timeout: 20000,
      });
    });

    test("puts Notepad's File Open away for Escape with the drives dropped, and opens it again", async ({
      page,
    }) => {
      const commdlg = join(DRIVE_C, 'SYSTEM', 'COMMDLG.DLL');

      test.skip(
        !existsSync(NOTEPAD) || !existsSync(commdlg),
        'the oracle pipeline has not run here'
      );

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive([
          ...installation(),
          { path: 'WINDOWS/SYSTEM/COMMDLG.DLL', data: new Uint8Array(readFileSync(commdlg)) },
        ]),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'NOTEPAD.EXE', data: new Uint8Array(readFileSync(NOTEPAD)) }]),
      });
      await page.getByRole('button', { name: 'Run C:\\APPS\\NOTEPAD.EXE' }).click();
      await expect(page.getByRole('group', { name: 'Notepad - (Untitled)' })).toHaveCount(1, {
        timeout: 20000,
      });

      const screen = page.getByRole('img', { name: 'The Windows screen' });

      await screen.scrollIntoViewIfNeeded();

      const box = (await screen.boundingBox())!;
      const on = (x: number, y: number) =>
        [box.x + ((x + 0.5) * box.width) / 640, box.y + ((y + 0.5) * box.height) / 480] as [
          number,
          number,
        ];
      const fileOpen = async () => {
        await page.keyboard.press('Alt+f');
        await page.keyboard.press('o');
        await expect(open).toHaveCount(1, { timeout: 20000 });
        await expect(open.getByText('c:\\apps', { exact: true })).toHaveCount(1);
      };
      const open = page.getByRole('group', { name: 'Open' });

      await screen.click({ position: { x: box.width / 2, y: (12 * box.height) / 480 } });
      await fileOpen();

      /* The drives' button, at (414,276) on the VGA, pressed: the list
       * drops. Escape is the dialog's Cancel, as Windows has it (`comboesc`):
       * a combo box keeps neither Escape nor Enter with its list down. The
       * list goes with the dialog, and the next File Open opens as the first
       * did. The mirror shows no combo box, so whether the list dropped is
       * the engines' own tests' to see (`file_dialogs`). */
      await page.mouse.click(...on(414, 276));
      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0, { timeout: 20000 });
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await fileOpen();
    });

    test("opens a sound from Media Player's File Open, a directory double-clicked and a file picked", async ({
      page,
    }) => {
      const commdlg = join(DRIVE_C, 'SYSTEM', 'COMMDLG.DLL');
      const mplayer = join(DRIVE_C, 'MPLAYER.EXE');

      test.skip(
        !existsSync(mplayer) || !existsSync(commdlg),
        'the oracle pipeline has not run here'
      );

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive([
          ...soundInstallation(),
          { path: 'WINDOWS/SYSTEM/COMMDLG.DLL', data: new Uint8Array(readFileSync(commdlg)) },
        ]),
      });
      /* Media Player in C:\APPS, and a sound in a folder beside it. */
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([
          { path: 'MPLAYER.EXE', data: new Uint8Array(readFileSync(mplayer)) },
          { path: 'SOUNDS/TONE.WAV', data: tone() },
        ]),
      });

      if (engine === 'ts') {
        /* No sound card: Media Player finds no device it can play, and
         * says so, as Windows does without one (`mplopen`). */
        await page.getByRole('button', { name: 'Run C:\\APPS\\MPLAYER.EXE' }).click();
        await expect(
          page.getByText(/^There are no MCI device drivers installed on your system/)
        ).toHaveCount(1, { timeout: 20000 });
        return;
      }

      await page.getByRole('checkbox', { name: 'Sound' }).check();
      await page.getByRole('button', { name: 'Run C:\\APPS\\MPLAYER.EXE' }).click();
      await expect(page.getByRole('group', { name: 'Media Player' })).toHaveCount(1, {
        timeout: 20000,
      });

      const screen = page.getByRole('img', { name: 'The Windows screen' });

      await screen.scrollIntoViewIfNeeded();

      const box = (await screen.boundingBox())!;
      const on = (x: number, y: number) =>
        [box.x + ((x + 0.5) * box.width) / 640, box.y + ((y + 0.5) * box.height) / 480] as [
          number,
          number,
        ];

      /* File, then Open, from the keyboard; Media Player's caption pressed
       * first, so it has the keys. */
      await screen.click({ position: { x: (200 * box.width) / 640, y: (10 * box.height) / 480 } });
      await page.keyboard.press('Alt+f');
      await page.keyboard.press('o');

      const open = page.getByRole('group', { name: 'Open' });

      await expect(open).toHaveCount(1, { timeout: 20000 });
      await expect(open.getByText('c:\\apps', { exact: true })).toHaveCount(1);

      /* The dialog at (56,54) on the VGA, Media Player's hook having left
       * its controls enabled for all files: the directories' rows 16 high
       * from 130, `c:\`, `apps`, `sounds`; the files' 13 high from 130.
       * `sounds` double-clicked is gone into. */
      await page.mouse.dblclick(...on(380, 170));
      await expect(open.getByText('c:\\apps\\sounds', { exact: true })).toHaveCount(1, {
        timeout: 20000,
      });

      const files = open.getByRole('listbox').first();

      await expect(files.getByRole('option')).toHaveCount(1);
      await expect(files.getByRole('option')).toHaveAttribute('aria-label', 'TONE.WAV');

      /* The file clicked gives the name its edit; OK opens it. */
      await page.mouse.click(...on(110, 136));
      await expect(open.getByRole('textbox')).toHaveText('tone.wav', { timeout: 20000 });
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('group', { name: 'Media Player - TONE.WAV (stopped)' })
      ).toHaveCount(1, { timeout: 20000 });
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
      /* The window goes as it is destroyed, the exit a few frames after,
       * as the task ends: under load, longer than the default wait. */
      await expect(status).toHaveText('The program has ended, with exit code 0.', {
        timeout: 20000,
      });
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
        await expect(status).toHaveText('The program has ended, with exit code 0.', {
          timeout: 20000,
        });
      }
    });

    test('keeps Windows up once the last program has ended, and runs the next on it', async ({
      page,
    }) => {
      test.skip(!existsSync(CLOCK), 'the oracle pipeline has not run here');

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(installation()),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'CLOCK.EXE', data: new Uint8Array(readFileSync(CLOCK)) }]),
      });

      /* The machine the page made: the TypeScript engine's Win16, or the
       * Rust engine's module's machine. */
      const machine = () =>
        page.evaluate(() => {
          const session = (globalThis as any).winbox.session;

          (globalThis as any).made = session?.win16 ?? session?.machine;
        });
      const same = () =>
        page.evaluate(() => {
          const session = (globalThis as any).winbox.session;

          return (session?.win16 ?? session?.machine) === (globalThis as any).made;
        });

      const window = page.getByRole('group', { name: 'Clock' });
      const status = page.locator('#status');

      await page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' }).click();
      await expect(window).toHaveCount(1, { timeout: 20000 });
      await machine();

      /* Made active on its caption, at the screen's corner (`usedef`), and
       * closed with Alt+F4. */
      const screen = page.getByRole('img', { name: 'The Windows screen' });
      const box = (await screen.boundingBox())!;

      await screen.click({ position: { x: (104 * box.width) / 640, y: (12 * box.height) / 480 } });
      await page.keyboard.press('Alt+F4');
      await expect(status).toHaveText('The program has ended, with exit code 0.', {
        timeout: 20000,
      });
      await expect(window).toHaveCount(0);

      /* Run again: on the same machine, Windows having stayed up. */
      await page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' }).click();
      await expect(window).toHaveCount(1, { timeout: 20000 });
      await expect(status).toHaveText('C:\\APPS\\CLOCK.EXE is running.');
      expect(await same()).toBe(true);

      /* Sound, where there is a card to give, is the machine's, as the
       * display is: ticked, the machine is made afresh. */
      if (engine === 'rust') {
        await page.getByRole('checkbox', { name: 'Sound' }).check();
        await expect.poll(same).toBe(false);
        await expect(window).toHaveCount(0);
      }
    });

    test('makes the machine afresh once its script is stopped in the middle of a call', async ({
      page,
      browserName,
    }) => {
      test.skip(engine !== 'rust', 'only the Rust engine runs in a module of its own');
      test.skip(
        browserName !== 'chromium',
        "the script is stopped through Chromium's own protocol"
      );
      test.skip(!existsSync(CLOCK), 'the oracle pipeline has not run here');

      /* What the module tells as it panics. */
      const panics: string[] = [];

      page.on('console', (message) => {
        if (message.text().startsWith('winbox-web: ')) {
          panics.push(message.text());
        }
      });

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(installation()),
      });
      await page.locator('#picker').setInputFiles({
        name: 'apps.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'CLOCK.EXE', data: new Uint8Array(readFileSync(CLOCK)) }]),
      });

      const window = page.getByRole('group', { name: 'Clock' });
      const status = page.locator('#status');
      const run = page.getByRole('button', { name: 'Run C:\\APPS\\CLOCK.EXE' });

      await run.click();
      await expect(window).toHaveCount(1, { timeout: 20000 });

      /* The page's script stopped inside the module, in the middle of a step,
       * as Firefox stops it when the page is closed: the page's clock, the
       * first time the module reads it, waits on a request, and once that is
       * answered runs on until the script is stopped. Nothing of the step's
       * Rust is let go: the system it borrowed stays borrowed. */
      const devtools = await page.context().newCDPSession(page);
      let held: () => void;
      const holding = new Promise<void>((resolve) => (held = resolve));

      await page.route('**/held', async (route) => {
        void devtools.send('Runtime.terminateExecution').catch(() => {});
        await route.fulfill({ body: '' });
        held();
      });
      await page.evaluate(() => {
        const now = performance.now.bind(performance);
        let armed = true;

        performance.now = () => {
          if (armed && /wasm/.test(new Error().stack ?? '')) {
            armed = false;

            const request = new XMLHttpRequest();

            request.open('GET', '/held', false);
            request.send();

            for (const until = now() + 10000; now() < until;) {
              /* Run on until stopped. */
            }

            (globalThis as any).ranOn = true;
          }

          return now();
        };
      });

      /* Stopped, not run on: the page answers again before the ten seconds. */
      await holding;
      expect(await page.evaluate(() => (globalThis as any).ranOn)).toBeUndefined();

      /* The stopped step asks for no frame after it. Run again, the machine
       * that was is lost, and told so; made afresh, it runs the next. */
      await run.click();
      await expect(status).toHaveText(
        'C:\\APPS\\CLOCK.EXE stopped: the module was stopped in the middle of a call, and answers no more'
      );
      await expect(window).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => (globalThis as any).winbox.session.machine !== null))
        .toBe(true);
      await run.click();
      await expect(window).toHaveCount(1, { timeout: 20000 });
      await expect(status).toHaveText('C:\\APPS\\CLOCK.EXE is running.');
      expect(
        Array.isArray(await page.evaluate(() => (globalThis as any).winbox.engine.changes()))
      ).toBe(true);
      expect(panics).toEqual([]);
    });

    test('ends a program that faults with 255, its windows taken away', async ({ page }) => {
      test.skip(
        !existsSync(FAULT) || !existsSync(FAULTC) || !existsSync(DRIVE_C),
        'the oracle pipeline has not run here'
      );

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(installation()),
      });
      await page.locator('#picker').setInputFiles({
        name: 'probes.zip',
        mimeType: 'application/zip',
        buffer: archive([
          { path: 'FAULT.EXE', data: new Uint8Array(readFileSync(FAULT)) },
          { path: 'FAULTC.EXE', data: new Uint8Array(readFileSync(FAULTC)) },
        ]),
      });

      /* Every line the status shows, kept, each as it was put there -- one
       * may be replaced before an observer is told: the probe goes on past
       * the program's end, and ends Windows. */
      await page.locator('#status').evaluate((line) => {
        const shown: string[] = [];

        (globalThis as any).shown = shown;
        new MutationObserver((changes) => {
          for (const change of changes) {
            for (const node of change.addedNodes) {
              shown.push(node.textContent ?? '');
            }
          }
        }).observe(line, { childList: true });
      });

      /* The probe starts FAULTC.EXE from its own folder, C:\PROBES, where
       * the page starts it; FAULTC.EXE, told WM_USER, faults. */
      await page.getByRole('button', { name: 'Run C:\\PROBES\\FAULT.EXE' }).click();

      /* KERNEL's first box, then Application Error, each answered with
       * Enter, its default Close (`fault`), until the probe has ended
       * Windows. */
      const ended = 'The program has ended, with exit code 255.';
      const exited = 'The program asked Windows to end the session, and has finished.';
      const shown = () => page.evaluate(() => (globalThis as any).shown as string[]);

      await page.locator('.screen-host').focus();

      for (let tries = 0; tries < 80 && !(await shown()).includes(exited); tries++) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
      }

      expect(await shown()).toContain(ended);
      await expect(page.getByRole('group', { name: 'Faulting' })).toHaveCount(0);
    });

    test('sounds what the sound card plays, with Sound ticked', async ({ page }) => {
      test.skip(engine !== 'rust', 'only the Rust engine has a sound card');
      test.skip(
        !existsSync(SNDPLAY) || !existsSync(DRIVE_C),
        'the oracle pipeline has not run here'
      );

      await page.addInitScript(standInForWebAudio);

      const files = [...soundInstallation(), { path: 'WINDOWS/TADA.WAV', data: tone() }];

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
       * or later, where the speaker had to begin afresh. The FM chip's
       * pieces, at 44,100, are queued in a lane of their own: quiet ones,
       * as the driver resets the chip. */
      await page.waitForFunction(
        () =>
          (globalThis as any).heard.buffers.filter((buffer: any) => buffer.peak > 0.5).length >= 3,
        null,
        { timeout: 20000 }
      );

      const heard = await page.evaluate(() => (globalThis as any).heard);

      expect(heard.started).toHaveLength(heard.buffers.length);

      const wave = {
        buffers: heard.buffers.filter((buffer: any) => buffer.rate !== 44100),
        started: heard.started
          .filter((source: any) => source.rate !== 44100)
          .map((source: any) => source.when),
      };
      const loud = wave.buffers.filter((buffer: any) => buffer.peak > 0.5);

      expect(
        heard.buffers.filter((buffer: any) => buffer.rate === 44100 && buffer.peak > 0)
      ).toEqual([]);
      expect(loud.reduce((sum: number, buffer: any) => sum + buffer.length, 0)).toBeGreaterThan(
        5512
      );

      for (let i = 1; i < wave.started.length; i++) {
        expect(wave.started[i] - wave.started[i - 1]).toBeGreaterThan(
          (0.99 * wave.buffers[i - 1].length) / wave.buffers[i - 1].rate
        );
      }

      for (const buffer of wave.buffers) {
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

    test('sounds the FM chip as MIDI plays, with Sound ticked', async ({ page }) => {
      test.skip(engine !== 'rust', 'only the Rust engine has a sound card');
      test.skip(
        !existsSync(ADLIBMAP) || !existsSync(DRIVE_C),
        'the oracle pipeline has not run here'
      );

      await page.addInitScript(standInForWebAudio);
      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await page.locator('#picker').setInputFiles({
        name: 'win31.zip',
        mimeType: 'application/zip',
        buffer: archive(soundInstallation()),
      });
      await page.locator('#picker').setInputFiles({
        name: 'probes.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'ADLIBMAP.EXE', data: new Uint8Array(readFileSync(ADLIBMAP)) }]),
      });

      await page.getByRole('checkbox', { name: 'Sound' }).check();
      await page.getByRole('button', { name: 'Run C:\\PROBES\\ADLIBMAP.EXE' }).click();

      /* The probe waits three seconds, then plays its notes: the FM chip's
       * sound, at 44,100 a second, a few milliseconds a buffer, the notes
       * loud in it; each buffer started as the one before it ends. */
      await page.waitForFunction(
        () =>
          (globalThis as any).heard.buffers.filter(
            (buffer: any) => buffer.rate === 44100 && buffer.peak > 0.05
          ).length >= 20,
        null,
        { timeout: 30000 }
      );

      const heard = await page.evaluate(() => (globalThis as any).heard);
      const fm = heard.buffers.filter((buffer: any) => buffer.rate === 44100);
      const started = heard.started
        .filter((source: any) => source.rate === 44100)
        .map((source: any) => source.when);

      expect(heard.buffers.every((buffer: any) => buffer.rate === 44100)).toBe(true);
      expect(started).toHaveLength(fm.length);

      for (const buffer of fm) {
        expect(buffer.length).toBeGreaterThanOrEqual(44);
        expect(buffer.length).toBeLessThanOrEqual(441);
      }

      /* Each joins the one before, or starts afresh after the lane ran dry. */
      for (let i = 1; i < started.length; i++) {
        expect(started[i] - started[i - 1]).toBeGreaterThan((0.99 * fm[i - 1].length) / 44100);
      }
    });

    test('has no Sound to tick on the TypeScript engine', async ({ page }) => {
      test.skip(engine !== 'ts', 'the Rust engine has one');

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(page.getByRole('checkbox', { name: 'Sound' })).toBeHidden();
    });

    test('keeps what a program writes, across a reload and on the other engine, until forgotten', async ({
      page,
    }) => {
      test.skip(
        !existsSync(STRINGS) || !existsSync(RUST),
        'the strings probe, or the Rust engine, has not been built here'
      );

      /* The probe writes what it found to C:\ORACLE\STRINGS.OUT: dropped as
       * oracle.zip, its folder is C:\ORACLE. */
      const out = 'C:\\ORACLE\\STRINGS.OUT';
      const changed = page.locator('#changed li');

      /* The engine's own drive, as it tells what differs on it from the
       * plan: each path, and the file's bytes. */
      const drive = () =>
        page.evaluate(async () => {
          const changes = await (globalThis as any).winbox.engine.changes();

          return Object.fromEntries(
            changes.map((change: any) => [
              change.path,
              change.kind === 'file'
                ? Array.from(change.data as Uint8Array).join(',')
                : change.kind,
            ])
          );
        });

      await page.goto(at);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(page.locator('#changes')).toContainText('Nothing written on C: yet.');
      await expect(page.getByRole('button', { name: 'Forget changes' })).toBeHidden();

      await page.locator('#picker').setInputFiles({
        name: 'oracle.zip',
        mimeType: 'application/zip',
        buffer: archive([{ path: 'STRINGS.EXE', data: new Uint8Array(readFileSync(STRINGS)) }]),
      });
      await page.getByRole('button', { name: 'Run C:\\ORACLE\\STRINGS.EXE' }).click();

      /* Kept as the program ends. */
      await expect(changed.filter({ hasText: out })).toHaveCount(1, { timeout: 20000 });

      const written = (await drive())['ORACLE\\STRINGS.OUT'];

      expect(written.length).toBeGreaterThan(0);

      /* Reloaded, with nothing dropped but what was remembered: the file put
       * back, in a folder of its own. */
      await page.reload();
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(changed.filter({ hasText: out })).toHaveCount(1);
      expect(await drive()).toEqual({ ORACLE: 'folder', 'ORACLE\\STRINGS.OUT': written });

      /* The other engine, on the same page, puts back the same. */
      await page
        .getByRole('link', {
          name: engine === 'ts' ? 'Use the Rust engine' : 'Use the TypeScript engine',
        })
        .click();
      await expect(page).toHaveURL(engine === 'ts' ? /engine=rust/ : /engine=ts/);
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(changed.filter({ hasText: out })).toHaveCount(1);
      expect(await drive()).toEqual({ ORACLE: 'folder', 'ORACLE\\STRINGS.OUT': written });

      /* Forgotten, and the drive as the plan has it. */
      await page.getByRole('button', { name: 'Forget changes' }).click();
      await expect(page.locator('#status')).toHaveText('Forgot what programs wrote.');
      await expect(changed).toHaveCount(0);
      expect(await drive()).toEqual({});

      await page.reload();
      await expect(page.locator('#status')).toHaveText('Ready.');
      await expect(changed).toHaveCount(0);
      expect(await drive()).toEqual({});
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

test('runs on the TypeScript engine where the Rust engine has not been built', async ({ page }) => {
  await page.route('**/target/winbox-web/winbox_web_bg.wasm', (route) =>
    route.fulfill({ status: 404 })
  );
  await page.goto('/run.html');
  await expect(page.locator('#status')).toHaveText('Ready.');
  await expect(page.locator('#engine')).toContainText('the Rust engine is not built');
  await expect(page.getByRole('link', { name: 'Use the Rust engine' })).toBeVisible();
});
