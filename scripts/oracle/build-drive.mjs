#!/usr/bin/env node
/**
 * Turns the installed Windows tree into a FAT16 drive image.
 *
 * The recording side does not strictly need this -- DOSBox is perfectly happy
 * mounting the host directory, which is how the install stage works. The image
 * is for our side: WinBox.js models a disk rather than a directory, so an
 * image is the shape it can consume.
 *
 * A bare volume, no partition table. `src/file-systems/fat16.ts` computes the
 * first data sector straight from the BPB with no partition offset in the
 * arithmetic, so that is the layout it expects, and a partitioned image would
 * put every sector in the wrong place.
 *
 *   node scripts/oracle/build-drive.mjs
 *   node scripts/oracle/build-drive.mjs --size 64      # megabytes
 *
 * Needs `mkfs.fat` (dosfstools) and `mtools`. Writes oracle/build/win31.img.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = join(ROOT, 'oracle', 'build');
const DRIVE = join(BUILD, 'drive-c');
const IMAGE = join(BUILD, 'win31.img');

/**
 * Forty megabytes, because that is what `Machine` allocates.
 *
 * Matching it means the image drops into the emulator without anyone having to
 * think about geometry.
 */
const DEFAULT_MEGABYTES = 40;

const LABEL = 'WINBOX';

function log(...args) {
  console.log(...args);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MTOOLS_SKIP_CHECK: '1' },
      ...options,
    });

    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));

    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} is not installed; it is needed to build the drive image`)
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

/** Counts what is on the host side, to check against the image afterwards. */
async function countTree(at) {
  let files = 0;
  let bytes = 0;

  for (const entry of await readdir(at, { withFileTypes: true })) {
    const path = join(at, entry.name);

    if (entry.isDirectory()) {
      const inner = await countTree(path);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files++;
      bytes += (await stat(path)).size;
    }
  }

  return { files, bytes };
}

/**
 * Counts what actually landed in the image, by walking it with mtools.
 *
 * `-/` recurses and `-b` gives one path per line; directories come back with a
 * trailing slash, which is how they are told apart from files.
 */
async function countImage(path) {
  const listing = await run('mdir', ['-i', path, '-b', '-/', '::/']);

  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('::/') && !line.endsWith('/')).length;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--size');
  const megabytes = at === -1 ? DEFAULT_MEGABYTES : Number(args[at + 1]);

  if (!Number.isFinite(megabytes) || megabytes < 8) {
    throw new Error('--size takes a number of megabytes, at least 8');
  }

  if (!(await stat(DRIVE).catch(() => null))) {
    throw new Error('nothing installed; run scripts/oracle/install-windows.mjs first');
  }

  const source = await countTree(DRIVE);
  log(`Source: ${source.files} files, ${(source.bytes / 1e6).toFixed(1)} MB`);

  if (source.bytes > megabytes * 1e6 * 0.9) {
    throw new Error(
      `${megabytes} MB is not enough for ${(source.bytes / 1e6).toFixed(1)} MB of files`
    );
  }

  await mkdir(BUILD, { recursive: true });
  await rm(IMAGE, { force: true });

  log(`Formatting ${megabytes} MB as FAT16...`);
  await run('mkfs.fat', ['-F', '16', '-n', LABEL, '-C', IMAGE, String(megabytes * 1024)]);

  log('Copying...');
  const entries = await readdir(DRIVE);

  for (const entry of entries) {
    await run('mcopy', ['-s', '-Q', '-i', IMAGE, join(DRIVE, entry), '::/']);
  }

  const copied = await countImage(IMAGE);

  if (copied !== source.files) {
    throw new Error(`copied ${copied} files but the tree has ${source.files}`);
  }

  const { size } = await stat(IMAGE);

  log(`\nDrive image at ${IMAGE}`);
  log(`  ${copied} files in ${(size / 1e6).toFixed(0)} MB, FAT16, no partition table`);
  log('\nNext: node scripts/oracle/build-probes.mjs');
}

main().catch((error) => {
  console.error(`build-drive: ${error.message}`);
  process.exitCode = 1;
});
