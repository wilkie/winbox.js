#!/usr/bin/env node
/**
 * Installs Windows 3.1 from the fetched floppy images, unattended.
 *
 * The tempting shortcut here is to expand the distribution's files by hand --
 * they are only SZDD-compressed -- and write the INI files ourselves. That
 * would be wrong in a way that matters for an oracle: `SETUP.EXE` is what
 * decides which drivers land in `SYSTEM.INI`, in what order, with what
 * settings, and an installation we composed from guesses would be a fine place
 * for our own misconceptions to hide. The whole point of recording against
 * real Windows is to avoid exactly that.
 *
 * So this runs Windows' own installer, using the unattended-install script
 * format it already supports. `SETUP /H:file.SHH` reads every answer it would
 * otherwise prompt for out of that file, which is how corporate rollouts were
 * done in 1992 and is the reason this is scriptable at all.
 *
 * Two details make it work headless. All six disks are extracted into a single
 * directory and mounted as A:, so Setup never asks for a disk swap it has no
 * way to receive -- each disk's marker file is present, so whichever one it
 * looks for, it finds. And DOSBox reads and writes an ordinary host directory,
 * so what comes out is a normal tree on disk rather than an image that would
 * need mounting.
 *
 *   node scripts/oracle/install-windows.mjs
 *   node scripts/oracle/install-windows.mjs --force    # reinstall
 *
 * Needs `mtools` and `dosbox` on the system. The result is oracle/build/drive-c.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const FLOPPIES = join(CACHE, 'floppies');
const STAGE = join(CACHE, 'setup-disk');
const BUILD = join(ROOT, 'oracle', 'build');
const DRIVE = join(BUILD, 'drive-c');

/**
 * The answers Setup would otherwise ask for.
 *
 * Every profile string here comes from a section of `SETUP.INF` on the media:
 * `vga` from [display], `nonet` from [network], `t4s0enha` from
 * [keyboard.types]. They are not free text, and a wrong one sends Setup to a
 * prompt that nothing is going to answer.
 *
 * Accessories are installed -- Notepad, Write, Cardfile and the rest are real
 * Win16 applications, and having a few genuine programs on the drive is worth
 * more to us than the megabyte they cost. Games, screen savers, wallpapers and
 * readmes are not.
 */
const ANSWERS = [
  '[sysinfo]',
  'showsysinfo=no',
  '',
  '[configuration]',
  'machine = ibm_compatible',
  'display = vga',
  'mouse = ps2mouse',
  'network = nonet',
  'keyboard = t4s0enha',
  'language = enu',
  'kblayout = nodll',
  '',
  '[windir]',
  'c:\\windows',
  '',
  '[userinfo]',
  '"WinBox.js oracle"',
  '"winbox.js"',
  '',
  '[dontinstall]',
  'readmes',
  'games',
  'screensavers',
  'bitmaps',
  '',
  '[options]',
  '',
  '[printers]',
  '',
  '[endinstall]',
  'configfiles = save',
  'endopt = exit',
];

/** What a finished installation has to contain before we believe in it. */
const REQUIRED = [
  'WINDOWS/WIN.COM',
  'WINDOWS/SYSTEM.INI',
  'WINDOWS/WIN.INI',
  'WINDOWS/PROGMAN.INI',
  'WINDOWS/SYSTEM/KRNL386.EXE',
  'WINDOWS/SYSTEM/USER.EXE',
  'WINDOWS/SYSTEM/GDI.EXE',
];

function log(...args) {
  console.log(...args);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });

    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));

    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} is not installed; it is needed to build the oracle drive`)
          : error
      )
    );

    child.on('close', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`${command} exited ${code}: ${output.trim()}`))
    );
  });
}

async function exists(path) {
  return (await stat(path).catch(() => null)) !== null;
}

/** Finds the floppy images the fetch stage extracted. */
async function findImages() {
  const found = [];

  async function walk(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        await walk(path);
      } else if (/\.(img|ima|dsk)$/i.test(entry.name)) {
        found.push(path);
      }
    }
  }

  if (!(await exists(FLOPPIES))) {
    throw new Error('no floppy images; run scripts/oracle/fetch-windows.mjs first');
  }

  await walk(FLOPPIES);
  return found.sort();
}

/**
 * Copies every disk into one directory.
 *
 * Setup asks for disks by looking for a marker file -- DISK1, DISK2 and so on
 * -- and with all of them in one place it finds whichever it wants and never
 * prompts for a swap.
 */
async function stageDisks(images) {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  for (const image of images) {
    // -m keeps the timestamps, -n overwrites without asking.
    await run('mcopy', ['-m', '-n', '-i', image, '::/*', STAGE], {
      env: { ...process.env, MTOOLS_SKIP_CHECK: '1' },
    });
  }

  const files = await readdir(STAGE);
  log(`  ${files.length} files from ${images.length} disks`);

  if (!files.includes('SETUP.EXE')) {
    throw new Error(`no SETUP.EXE among the staged files in ${STAGE}`);
  }
}

/** Runs Setup under DOSBox against the staged disk. */
async function install() {
  const answers = join(STAGE, 'ORACLE.SHH');

  // Setup is a DOS program from 1992; it wants CRLF.
  await writeFile(answers, `${ANSWERS.join('\r\n')}\r\n`);

  const config = join(BUILD, 'install.conf');

  await writeFile(
    config,
    [
      '[dosbox]',
      'machine=svga_s3',
      'memsize=16',
      '[cpu]',
      'core=auto',
      'cycles=max',
      '[sdl]',
      'autolock=false',
      '[autoexec]',
      `mount c ${DRIVE}`,
      `mount a ${STAGE} -t floppy`,
      'a:',
      'setup /h:a:\\ORACLE.SHH',
      'exit',
      '',
    ].join('\n')
  );

  /* Setup draws a full-screen installer either way, so it renders into
   * nothing rather than onto a display nobody is watching.
   */
  await run('dosbox', ['-conf', config, '-exit'], {
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
  });
}

/**
 * Checks the installation rather than trusting the exit code.
 *
 * DOSBox exits zero whatever the program inside it did, so the only real
 * evidence is the files on the drive.
 */
async function verify() {
  const missing = [];

  for (const path of REQUIRED) {
    if (!(await exists(join(DRIVE, path)))) {
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Setup did not finish; these are missing:\n  ${missing.join('\n  ')}\n` +
        `Look at ${join(DRIVE, 'WINDOWS', 'SETUP.LOG')} if it exists.`
    );
  }

  // A file Setup failed to expand would leave the compressed name behind.
  const leftovers = [];

  async function walk(at, prefix = '') {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(join(at, entry.name), `${prefix}${entry.name}/`);
      } else if (/\.[a-z0-9]{2}_$/i.test(entry.name)) {
        leftovers.push(`${prefix}${entry.name}`);
      }
    }
  }

  await walk(DRIVE);

  if (leftovers.length > 0) {
    throw new Error(`${leftovers.length} files were never expanded, starting with ${leftovers[0]}`);
  }
}

async function measure() {
  let files = 0;
  let bytes = 0;

  async function walk(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        await walk(path);
      } else {
        files++;
        bytes += (await stat(path)).size;
      }
    }
  }

  await walk(DRIVE);
  return { files, bytes };
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && (await exists(join(DRIVE, REQUIRED[0])))) {
    const { files, bytes } = await measure();
    log(`Installed: ${DRIVE} (${files} files, ${(bytes / 1e6).toFixed(1)} MB)`);
    log('Pass --force to install again.');
    return;
  }

  const images = await findImages();
  log(`Staging ${images.length} floppy images...`);
  await stageDisks(images);

  await rm(DRIVE, { recursive: true, force: true });
  await mkdir(DRIVE, { recursive: true });

  log('Running Setup under DOSBox (a few minutes)...');
  await install();

  log('Verifying...');
  await verify();

  const { files, bytes } = await measure();
  log(`\nWindows 3.1 installed to ${DRIVE}`);
  log(`  ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);
  log('\nNext: node scripts/oracle/build-drive.mjs');
}

main().catch((error) => {
  console.error(`install-windows: ${error.message}`);
  process.exitCode = 1;
});
