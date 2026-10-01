#!/usr/bin/env node
/**
 * Installs WinG on the oracle's 256-colour Windows, with WinG's own Setup.
 *
 * WinG is Microsoft's 1994 library for drawing fast into device-independent
 * bitmaps, given away for Windows 3.1 and never part of it. SimTower needs
 * it, and Windows without it stops at "Cannot find WING.DLL"; to record what
 * a program using it draws, the oracle has to have it as its users did.
 *
 * As with Windows itself (`install-windows.mjs`), Setup decides what lands
 * where: the files are fetched from archive.org's copy of Microsoft's
 * release, checked by SHA-1, and put on the drive; Windows is started with
 * WinG's `MSSETUP.EXE` as its shell, on a virtual X display; its two boxes,
 * the welcome and the end, are answered with Enter; and when Setup ends, so
 * does Windows. Then WinG is run once, by the `wingprof` probe, for the
 * timing of the display it does on its first run and keeps in `WIN.INI`.
 * `SYSTEM.INI`'s shell is put back afterwards, and the setup files taken off
 * the drive. A screen is kept of each step in
 * oracle/build/screens/wing-*.png, to look at when something stops.
 *
 *   node scripts/oracle/install-wing.mjs              # onto vga256
 *   node scripts/oracle/install-wing.mjs --display svga
 *
 * Needs `Xvfb`, ImageMagick's `import`, `dosbox` and 7-Zip (`7zip-bin`).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sevenZip from '7zip-bin';

import { DISPLAYS, driveFor } from './install-windows.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache', 'wing');
const BUILD = join(ROOT, 'oracle', 'build');
const SCREENS = join(BUILD, 'screens');
const PROBES = join(BUILD, 'probes');

const URL = 'https://archive.org/download/microsoft-wing-setup/wing.zip';
const SHA1 = 'bff7859f6965dcd69c24b4cef104d4f3c924cc4c';

/** Where Setup's files go on the drive while it runs. */
const FOLDER = 'WINGSET';

function log(...args) {
  console.log(...args);
}

function run(command, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: 'ignore', ...options });

    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} exited with ${code}`))
    );
  });
}

const pause = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));

/** The release, fetched once and checked. */
async function fetchWinG() {
  await mkdir(CACHE, { recursive: true });

  const archive = join(CACHE, 'wing.zip');
  let data = (await stat(archive).catch(() => null)) ? await readFile(archive) : null;

  if (!data || createHash('sha1').update(data).digest('hex') !== SHA1) {
    log(`Downloading ${URL}...`);
    const response = await fetch(URL);

    if (!response.ok) {
      throw new Error(`${URL}: HTTP ${response.status}`);
    }

    data = Buffer.from(await response.arrayBuffer());
    await writeFile(archive, data);
  }

  const sha1 = createHash('sha1').update(data).digest('hex');

  if (sha1 !== SHA1) {
    throw new Error(`wing.zip has SHA-1 ${sha1}, not ${SHA1}`);
  }

  await run(sevenZip.path7za, ['x', '-y', `-o${CACHE}`, archive]);

  return join(CACHE, 'wing');
}

/** Sets `[boot] shell=`, answering what it was. */
async function setShell(drive, shell) {
  const path = join(drive, 'WINDOWS', 'SYSTEM.INI');
  const text = await readFile(path, 'latin1');
  const was = /^shell=(.*)$/im.exec(text)?.[1];

  if (was === undefined) {
    throw new Error(`no shell= line in ${path}`);
  }

  await writeFile(path, text.replace(/^shell=.*$/im, `shell=${shell}`), 'latin1');

  return was.trim();
}

/**
 * Windows started on the drive with whatever shell `SYSTEM.INI` names, on a
 * virtual display; `steps` then run, given a screen-taker and a key-presser,
 * and Windows is waited for to end, as it does when its shell does.
 */
async function runWindows(display, drive, steps, limit = 60) {
  const config = join(BUILD, 'wing.conf');
  const displayName = ':94';

  await writeFile(
    config,
    [
      '[dosbox]',
      `machine=${DISPLAYS[display].machine}`,
      'memsize=16',
      '[cpu]',
      'core=auto',
      'cycles=max',
      '[sdl]',
      'autolock=false',
      'output=surface',
      '[render]',
      'scaler=none',
      'aspect=false',
      '[autoexec]',
      `mount c ${drive}`,
      'c:',
      'cd \\WINDOWS',
      'win /s',
      'exit',
      '',
    ].join('\n')
  );

  await mkdir(SCREENS, { recursive: true });

  const xvfb = spawn('Xvfb', [displayName, '-screen', '0', '800x600x24', '-extension', 'GLX'], {
    stdio: 'ignore',
  });

  await pause(1);

  const dosbox = spawn('dosbox', ['-conf', config, '-exit'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DISPLAY: displayName,
      SDL_VIDEODRIVER: 'x11',
      SDL_AUDIODRIVER: 'dummy',
      SDL_VIDEO_WINDOW_POS: '0,0',
    },
  });
  const take = (name) =>
    run('import', [
      '-display',
      displayName,
      '-window',
      'root',
      '-crop',
      '640x480+0+0',
      join(SCREENS, `wing-${name}.png`),
    ]).catch(() => {});
  const press = (...keys) =>
    run('python3', [join(ROOT, 'scripts', 'oracle', 'xkeys.py'), displayName, ...keys]);

  try {
    await steps(take, press);

    const ending = Date.now();

    while (dosbox.exitCode === null && Date.now() - ending < limit * 1000) {
      await pause(1);
    }

    await take('after');

    if (dosbox.exitCode === null) {
      throw new Error('Windows did not end with its shell; see oracle/build/screens/wing-*.png');
    }
  } finally {
    dosbox.kill('SIGKILL');
    xvfb.kill('SIGKILL');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--display');
  const display = at === -1 ? 'vga256' : args[at + 1];
  const drive = driveFor(display);

  if (!DISPLAYS[display] || !(await stat(join(drive, 'WINDOWS')).catch(() => null))) {
    throw new Error(
      `nothing installed for ${display}; run install-windows.mjs --display ${display}`
    );
  }

  const files = await fetchWinG();
  const setup = join(drive, FOLDER);

  await rm(setup, { recursive: true, force: true });
  await cp(files, setup, { recursive: true });

  const shell = await setShell(drive, `C:\\${FOLDER}\\MSSETUP.EXE`);

  try {
    log(`Running WinG Setup on ${DISPLAYS[display].description}...`);

    /* The welcome box, answered Continue; then the copying, and the box
     * saying it is done, answered OK. */
    await runWindows(display, drive, async (take, press) => {
      await pause(25);
      await take('1-welcome');
      await press('Return');
      await pause(25);
      await take('2-done');
      await press('Return');
    });

    /* And WinG's first run, its timing of the display, kept in WIN.INI as
     * on any machine where a WinG program had run: `wingprof` asks for the
     * recommended format and ends Windows when WinG has answered. */
    log('Running WinG once, for its timing of the display...');
    await cp(join(PROBES, 'WINGPROF.EXE'), join(drive, 'WINDOWS', 'WINGPROF.EXE'));
    await mkdir(join(drive, 'ORACLE'), { recursive: true });
    await setShell(drive, 'WINGPROF.EXE');
    await runWindows(
      display,
      drive,
      async (take) => {
        await pause(60);
        await take('3-timing');
      },
      20 * 60
    );
  } finally {
    await setShell(drive, shell);
    await rm(setup, { recursive: true, force: true });
    await rm(join(drive, 'WINDOWS', 'WINGPROF.EXE'), { force: true });
    await rm(join(drive, 'ORACLE'), { recursive: true, force: true });
  }

  if (!/^\[WinG\]/im.test(await readFile(join(drive, 'WINDOWS', 'WIN.INI'), 'latin1'))) {
    throw new Error('WinG kept no [WinG] in WIN.INI; see oracle/build/screens/wing-*.png');
  }

  for (const file of ['WING.DLL', 'WINGDE.DLL', 'WINGDIB.DRV', 'WINGPAL.WND']) {
    if (!(await stat(join(drive, 'WINDOWS', 'SYSTEM', file)).catch(() => null))) {
      throw new Error(`Setup did not install ${file}; see oracle/build/screens/wing-*.png`);
    }
  }

  log(`WinG is in ${join(drive, 'WINDOWS', 'SYSTEM')}.`);
  log(`Next: node scripts/oracle/build-drive.mjs --display ${display}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`install-wing: ${error.message}`);
    process.exitCode = 1;
  });
}
