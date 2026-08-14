#!/usr/bin/env node
/**
 * Fetches a Windows 3.1 distribution for the API oracle.
 *
 * The oracle needs a real Windows 3.1 to record against: our implementation of
 * an API function is only worth as much as the thing we compared it to, and
 * the only authority on what `GetTextExtent` returns is Windows returning it.
 * So the pipeline starts here, with the actual retail media.
 *
 * WinWorld hosts the abandonware library. Getting a file takes three hops --
 * the product page lists releases, a release page lists mirrors, and a mirror
 * redirects to the archive -- so this walks that chain rather than hardcoding
 * a URL that would rot. Editions are matched by their label, so `--edition`
 * takes something like "retail" or "3.5" and the exact download id stays an
 * implementation detail.
 *
 *   node scripts/oracle/fetch-windows.mjs             # retail 3.5" set
 *   node scripts/oracle/fetch-windows.mjs --list      # every edition offered
 *   node scripts/oracle/fetch-windows.mjs --edition "5.25"
 *
 * The archive lands in oracle/.cache/ and the floppy images are extracted
 * beside it. None of it is committed: this is thirty-year-old software that
 * Microsoft has never sold in this form since, but it is still their copyright,
 * and a fetch script the user runs is a different thing from a redistribution.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sevenZip from '7zip-bin';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const FLOPPIES = join(CACHE, 'floppies');

const SITE = 'https://winworldpc.com';
const PRODUCT = `${SITE}/product/windows-3/31`;

/** WinWorld serves the library to browsers; say so rather than pretending. */
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};

/**
 * Which edition to take when none is named.
 *
 * The retail 3.5-inch set is the one to develop against: it is the plain
 * product without an OEM's driver substitutions, and the six 1.44 MB images
 * are what every other tool expects to be handed.
 */
const DEFAULT_EDITION = 'Windows 3.1 (Retail) (3.5-1.44mb)';

function log(...args) {
  console.log(...args);
}

async function fetchText(url, referer) {
  const response = await fetch(url, {
    headers: referer ? { ...HEADERS, referer } : HEADERS,
  });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  return response.text();
}

/**
 * Lists the editions the product page offers.
 *
 * @returns {Promise<{id: string, label: string}[]>}
 */
async function listEditions() {
  const page = await fetchText(PRODUCT);
  const editions = [];
  const seen = new Set();

  const pattern = /href="(\/download\/[0-9a-f-]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of page.matchAll(pattern)) {
    const label = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (!label || seen.has(match[1])) {
      continue;
    }

    seen.add(match[1]);
    editions.push({ id: match[1], label });
  }

  return editions;
}

/**
 * Picks the edition whose label matches, preferring an exact hit.
 *
 * @param {{id: string, label: string}[]} editions - Everything on offer.
 * @param {string} wanted - An exact label or a fragment of one.
 */
function selectEdition(editions, wanted) {
  const exact = editions.find((edition) => edition.label === wanted);
  if (exact) {
    return exact;
  }

  const needle = wanted.toLowerCase();
  const matches = editions.filter((edition) => edition.label.toLowerCase().includes(needle));

  if (matches.length === 0) {
    throw new Error(`no edition matching "${wanted}"; try --list`);
  }

  if (matches.length > 1) {
    const names = matches.map((edition) => `  ${edition.label}`).join('\n');
    throw new Error(`"${wanted}" matches ${matches.length} editions:\n${names}`);
  }

  return matches[0];
}

/**
 * Resolves an edition to the archive it downloads from.
 *
 * The release page offers the same file from several mirrors; any of them will
 * do, so this takes the first that answers with a redirect to a file.
 */
async function resolveArchive(edition) {
  const releasePage = await fetchText(`${SITE}${edition.id}`, PRODUCT);

  const mirrors = [
    ...releasePage.matchAll(/href="(\/download\/[0-9a-f-]+\/from\/[0-9a-f-]+)"/g),
  ].map((match) => match[1]);

  if (mirrors.length === 0) {
    throw new Error(`${edition.label}: the release page offered no mirrors`);
  }

  const failures = [];

  for (const mirror of mirrors) {
    const response = await fetch(`${SITE}${mirror}`, {
      headers: { ...HEADERS, referer: `${SITE}${edition.id}` },
      redirect: 'follow',
    });

    if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
      return response;
    }

    failures.push(`${mirror}: HTTP ${response.status}`);
    await response.body?.cancel();
  }

  throw new Error(`${edition.label}: no mirror served a file\n  ${failures.join('\n  ')}`);
}

function formatSize(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Downloads to `target`, reporting progress against the declared length. */
async function download(response, target) {
  const expected = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  let announced = 0;

  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;

    // A line per ten percent, so a slow mirror still looks alive.
    if (expected && received - announced > expected / 10) {
      announced = received;
      log(`  ${formatSize(received)} of ${formatSize(expected)}`);
    }
  }

  const data = Buffer.concat(chunks);
  await writeFile(target, data);

  return data;
}

/** Runs the bundled 7-Zip, which spares the user a system package. */
function extract(archive, into) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(sevenZip.path7za, ['x', '-y', `-o${into}`, archive], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`7za exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/** Collects the floppy images out of however the archive nested them. */
async function collectImages(directory) {
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

  await walk(directory);
  return found.sort();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    log(
      await readFile(new URL(import.meta.url), 'utf8').then((text) =>
        text.slice(0, text.indexOf(' */') + 3)
      )
    );
    return;
  }

  const editions = await listEditions();

  if (args.includes('--list')) {
    log(`${editions.length} editions of Windows 3.1 on WinWorld:\n`);
    for (const edition of editions) {
      log(`  ${edition.label}`);
    }
    return;
  }

  const at = args.indexOf('--edition');
  const wanted = at === -1 ? DEFAULT_EDITION : args[at + 1];

  if (at !== -1 && !wanted) {
    throw new Error('--edition needs a label; try --list');
  }

  const edition = selectEdition(editions, wanted);
  log(`Edition: ${edition.label}`);

  await mkdir(CACHE, { recursive: true });

  const archive = join(CACHE, 'distribution.7z');
  const stamp = join(CACHE, 'distribution.json');

  // Re-fetching six megabytes on every run helps nobody.
  const cached = await readFile(stamp, 'utf8')
    .then(JSON.parse)
    .catch(() => null);

  let data;

  if (cached?.label === edition.label && (await stat(archive).catch(() => null))) {
    log(`Cached: ${archive}`);
    data = await readFile(archive);
  } else {
    log('Resolving a mirror...');
    const response = await resolveArchive(edition);

    const name = /filename="?([^"]+?)"?"?$/.exec(
      response.headers.get('content-disposition') ?? ''
    )?.[1];

    log(`Downloading ${name ?? 'archive'}...`);
    data = await download(response, archive);
  }

  const sha256 = createHash('sha256').update(data).digest('hex');
  log(`  ${formatSize(data.length)}, sha256 ${sha256.slice(0, 16)}...`);

  log('Extracting...');
  await rm(FLOPPIES, { recursive: true, force: true });
  await extract(archive, FLOPPIES);

  const images = await collectImages(FLOPPIES);

  if (images.length === 0) {
    throw new Error(`no floppy images in ${archive}`);
  }

  await writeFile(
    stamp,
    `${JSON.stringify(
      {
        label: edition.label,
        id: edition.id,
        sha256,
        bytes: data.length,
        images: images.map((path) => path.slice(FLOPPIES.length + 1)),
      },
      null,
      2
    )}\n`
  );

  log(`\n${images.length} floppy images in ${FLOPPIES}:`);
  for (const image of images) {
    const { size } = await stat(image);
    log(`  ${image.slice(FLOPPIES.length + 1)}  ${(size / 1024).toFixed(0)} KiB`);
  }

  log('\nNext: node scripts/oracle/install-windows.mjs');
}

main().catch((error) => {
  console.error(`fetch-windows: ${error.message}`);
  process.exitCode = 1;
});
