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
    locals.push(...name, ...file.data);

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

test('lists the programs in a dropped archive, on C: as 8.3 names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/run.html');
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

/* A real Windows program, where the oracle has built one: the `strings` probe,
 * which needs no fonts. It is not committed, so this runs only where the
 * pipeline has been run. */
const STRINGS = join(process.cwd(), 'oracle', 'build', 'probes', 'STRINGS.EXE');

test('runs a real Windows program and traces its calls', async ({ page }) => {
  test.skip(!existsSync(STRINGS), 'the strings probe has not been built here');

  await page.goto('/run.html');
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

const DRIVE_C = join(process.cwd(), 'oracle', 'build', 'drive-c', 'WINDOWS');
const CHROME = join(process.cwd(), 'oracle', 'build', 'probes', 'CHROME.EXE');

test("draws a real program's windows on the raster screen, from the installation's driver", async ({
  page,
}) => {
  test.skip(!existsSync(CHROME) || !existsSync(DRIVE_C), 'the oracle pipeline has not run here');

  /* An installation of just what the screen needs: SYSTEM.INI, which names
   * the display driver, the driver, and the fonts. */
  const system = join(DRIVE_C, 'SYSTEM');
  const files = [
    { path: 'WINDOWS/SYSTEM.INI', data: new Uint8Array(readFileSync(join(DRIVE_C, 'SYSTEM.INI'))) },
    ...readdirSync(system)
      .filter((name: string) => /\.(FON|DRV)$/i.test(name))
      .map((name: string) => ({
        path: `WINDOWS/SYSTEM/${name}`,
        data: new Uint8Array(readFileSync(join(system, name))),
      })),
  ];

  await page.goto('/run.html');
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

  /* The screen takes the keyboard when it is pressed, as Windows' input. */
  await screen.click({ position: { x: 10, y: 10 } });
  await expect(screen).toBeFocused();

  await page.getByRole('button', { name: 'Run C:\\PROBES\\CHROME.EXE' }).click();

  await expect(page.locator('#counts')).toContainText('USER.CreateWindow', { timeout: 20000 });
  await expect(page.locator('#counts')).toContainText('USER.ShowWindow');
  await expect(page.locator('#status')).not.toContainText('stopped');

  /* Past its message pump, which once waited on an empty queue, to reading the
   * window back from the screen. */
  await expect(page.locator('#counts')).toContainText('USER.GetWindowRect', { timeout: 20000 });
  await expect(page.locator('#counts')).toContainText('GDI.GetPixel');
});
