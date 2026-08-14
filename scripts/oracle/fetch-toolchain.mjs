#!/usr/bin/env node
/**
 * Fetches the Open Watcom cross-compiler used to build the oracle's probes.
 *
 * Probing an API means calling it with known arguments and reporting what came
 * back, which means real Win16 binaries. Open Watcom is the only maintained
 * compiler that still targets 16-bit Windows, and its V2 builds are hosted on
 * Linux, so probes cross-compile here rather than inside an emulated DOS.
 *
 * The published installer is an ordinary zip with a stub on the front, so it
 * extracts without running anything -- which is what makes this scriptable.
 * Only the pieces a Win16 build touches are kept; the full archive expands to
 * around 300 MB and most of it targets platforms we will never build for.
 *
 *   node scripts/oracle/fetch-toolchain.mjs
 *   node scripts/oracle/fetch-toolchain.mjs --tag 2026-08-01-Build
 *   node scripts/oracle/fetch-toolchain.mjs --full     # keep everything
 *
 * The toolchain lands in oracle/.cache/watcom/ and is not committed.
 */

import { spawn } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sevenZip from '7zip-bin';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const WATCOM = join(CACHE, 'watcom');

/**
 * A dated build rather than the moving `Current-build` tag.
 *
 * An oracle that changes underneath you is not an oracle, and a compiler
 * upgrade that silently changes generated code would show up as the API
 * misbehaving. Bump this deliberately.
 */
const DEFAULT_TAG = '2026-08-01-Build';
const ASSET = 'open-watcom-2_0-c-linux-x64';

const RELEASES = 'https://api.github.com/repos/open-watcom/open-watcom-v2/releases';

/**
 * What a Win16 build actually reads.
 *
 * `binl64` is the Linux-hosted toolchain, `h` and `h/win` the C and Windows
 * headers, `lib286` the 16-bit libraries and import stubs.
 */
const NEEDED = ['binl64/*', 'h/*', 'lib286/*'];

function log(...args) {
  console.log(...args);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));

    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`))
    );
  });
}

async function resolveAsset(tag) {
  const url = tag === 'latest' ? `${RELEASES}?per_page=1` : `${RELEASES}/tags/${tag}`;

  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'winbox.js-oracle' },
  });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  const body = await response.json();
  const release = Array.isArray(body) ? body[0] : body;
  const asset = release.assets?.find((candidate) => candidate.name === ASSET);

  if (!asset) {
    throw new Error(`release ${release.tag_name} has no asset named ${ASSET}`);
  }

  return { tag: release.tag_name, url: asset.browser_download_url, bytes: asset.size };
}

async function download(url, target, expected) {
  const response = await fetch(url, { headers: { 'user-agent': 'winbox.js-oracle' } });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  const chunks = [];
  let received = 0;
  let announced = 0;

  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;

    if (expected && received - announced > expected / 10) {
      announced = received;
      log(`  ${(received / 1e6).toFixed(0)} MB of ${(expected / 1e6).toFixed(0)} MB`);
    }
  }

  await writeFile(target, Buffer.concat(chunks));
}

/** Marks the Linux-hosted tools executable; a zip does not carry the bit. */
async function makeExecutable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile()) {
      await chmod(join(directory, entry.name), 0o755);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--tag');
  const tag = at === -1 ? DEFAULT_TAG : args[at + 1];

  await mkdir(CACHE, { recursive: true });

  const installer = join(CACHE, `${ASSET}.zip`);
  const stamp = join(WATCOM, '.tag');

  const already = await readFile(stamp, 'utf8').catch(() => null);

  if (already?.trim() === tag) {
    log(`Cached: ${WATCOM} (${tag})`);
  } else {
    if (!(await stat(installer).catch(() => null))) {
      log(`Resolving Open Watcom ${tag}...`);
      const asset = await resolveAsset(tag);

      log(`Downloading ${ASSET} (${(asset.bytes / 1e6).toFixed(0)} MB)...`);
      await download(asset.url, installer, asset.bytes);
    }

    /* The installer is a zip with an executable stub in front of it, so it
     * extracts without being run -- no interactive setup, no GUI.
     */
    log('Extracting...');
    const wanted = args.includes('--full') ? [] : NEEDED;
    await run(sevenZip.path7za, ['x', '-y', `-o${WATCOM}`, installer, ...wanted]);

    await makeExecutable(join(WATCOM, 'binl64'));
    await writeFile(stamp, `${tag}\n`);
  }

  // Prove the toolchain runs before anything downstream depends on it.
  const compiler = join(WATCOM, 'binl64', 'wcc');

  if (!(await stat(compiler).catch(() => null))) {
    throw new Error(`no 16-bit compiler at ${compiler}`);
  }

  log(`\nOpen Watcom ${tag} in ${WATCOM}`);
  log(`  wcc    ${compiler}`);
  log(`  wlink  ${join(WATCOM, 'binl64', 'wlink')}`);
  log('\nNext: node scripts/oracle/build-probes.mjs');
}

main().catch((error) => {
  console.error(`fetch-toolchain: ${error.message}`);
  process.exitCode = 1;
});
