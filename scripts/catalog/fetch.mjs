#!/usr/bin/env node
/**
 * The first pass's fetch: every item of `catalog/catalog.json`, each of its
 * downloads fetched from archive.org, held to archive.org's SHA-1, and
 * unpacked into the gitignored `corpus/programs/catalog/<id>/`. The design
 * is `kb/guides/compatibility.md`, "The automated first pass".
 *
 *   node scripts/catalog/fetch.mjs              # everything not yet fetched, smallest first
 *   node scripts/catalog/fetch.mjs win3_nails   # these
 *   node scripts/catalog/fetch.mjs --status     # what has been fetched so far
 *
 * Polite to archive.org: at most `PARALLEL` downloads at once, a request
 * started no sooner than `DELAY` after the last, the User-Agent "WinBox
 * catalog", no credentials. A download is written to a `.part` file and
 * resumed from where it stopped (an HTTP range) when run again; an item
 * fetched and unpacked is not fetched again.
 *
 * Downloads are untrusted. Each item's downloads are kept in
 * `corpus/cache/catalog/downloads/<id>/`, and unpacked into a folder of its
 * own: a zip by the corpus's unpacker, which refuses any member whose name
 * leaves the folder, or, past `IN_MEMORY`, by the system's `unzip`, which
 * skips such members; a disc's or a floppy's image is not copied, but
 * mounted from the downloads' folder when the program runs; any other file
 * is copied in as it is. Nothing of it is run on the host. The fetch's
 * outcome is kept in `corpus/cache/catalog/pass/<id>.json`.
 *
 * It stops, between items, when what has been unpacked passes `LIMIT`
 * (the owner's brief, 2026-11-14).
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { unpack } from '../corpus/fetch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog');
export const DOWNLOADS = join(CACHE, 'downloads');
export const STATE = join(CACHE, 'pass');
export const PROGRAMS = join(ROOT, 'corpus', 'programs', 'catalog');

const USER_AGENT = 'WinBox catalog';
/** Downloads at once. */
const PARALLEL = 3;
/** Milliseconds between the starts of two requests. */
const DELAY = 1000;
/** A zip larger than this is unpacked by the system's `unzip`, not in memory. */
const IN_MEMORY = 256 * 2 ** 20;
/** Unpacked bytes past which the fetch stops. */
const LIMIT = 150e9;

/** An image mounted as a drive, not unpacked: a disc's or a floppy's. */
export const IMAGE = /\.(iso|cue|bin|img|ima|dsk|vfd|mdf|mds|nrg|ccd|toast)$/i;
/** An archive the fetch cannot unpack (no unpacker on the host). */
const UNPACKABLE = /\.(7z|rar|lzh|arj)$/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the pass has kept of an item. */
export function stateOf(id) {
  const file = join(STATE, `${id}.json`);

  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** An item's state changed and kept. */
export function keep(id, change) {
  const state = { ...stateOf(id), ...change };

  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, `${id}.json`), JSON.stringify(state, null, 1));
  return state;
}

/** A download's file in the cache: its path within the item kept, made safe. */
export function downloadPath(id, file) {
  const parts = file.split('/').filter((part) => part && part !== '..' && part !== '.');

  return join(DOWNLOADS, id, ...parts);
}

function sha1Of(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');

    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

let nextStart = 0;

/** A request started no sooner than `DELAY` after the last one. */
async function turn() {
  const now = Date.now();
  const at = Math.max(now, nextStart);

  nextStart = at + DELAY;
  await wait(at - now);
}

/**
 * One download into the cache, resumed from its `.part` where one is
 * there, and held to archive.org's SHA-1. Returns the bytes fetched now.
 */
async function download(id, entry) {
  const file = downloadPath(id, entry.file);
  const part = `${file}.part`;

  if (existsSync(file)) {
    return 0;
  }

  mkdirSync(dirname(file), { recursive: true });

  const url = `https://archive.org/download/${encodeURIComponent(id)}/${entry.file
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  let have = existsSync(part) ? statSync(part).size : 0;

  await turn();

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...(have ? { Range: `bytes=${have}-` } : {}) },
  });

  if (response.status === 416 && have) {
    /* Already whole. */
  } else if (!response.ok) {
    throw new Error(`${entry.file}: archive.org answered ${response.status}`);
  } else {
    if (have && response.status !== 206) {
      have = 0;
    }

    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(part, { flags: have ? 'a' : 'w' })
    );
  }

  const fetched = statSync(part).size - have;
  const sha1 = await sha1Of(part);

  if (entry.sha1 && sha1 !== entry.sha1) {
    rmSync(part, { force: true });
    throw new Error(`${entry.file}: SHA-1 ${sha1}, archive.org says ${entry.sha1}`);
  }

  renameSync(part, file);
  return fetched;
}

/** The bytes of every file in a folder, at any depth. */
export function bytesIn(folder) {
  let total = 0;

  for (const item of existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []) {
    const path = join(folder, item.name);

    total += item.isDirectory() ? bytesIn(path) : item.isFile() ? statSync(path).size : 0;
  }

  return total;
}

/**
 * The downloads unpacked into the item's folder: zips unpacked, images left
 * where they are (they are mounted), archives with no unpacker named, other
 * files copied in.
 */
async function unpackAll(id, downloads, folder) {
  const notes = [];

  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  for (const entry of downloads) {
    const file = downloadPath(id, entry.file);
    const name = entry.file.split('/').pop();

    if (/\.zip$/i.test(name)) {
      try {
        if (statSync(file).size <= IN_MEMORY) {
          unpack(file, folder);
        } else {
          await promisify(execFile)('unzip', ['-o', '-qq', file, '-d', folder], {
            maxBuffer: 2 ** 24,
          });
        }
      } catch (error) {
        /* `unzip` answers 1 for warnings (a member skipped), and has unpacked the rest. */
        if (error.code !== 1) {
          notes.push(`${entry.file}: ${String(error.message).split('\n')[0]}`);
        }
      }
    } else if (IMAGE.test(name)) {
      continue;
    } else if (UNPACKABLE.test(name)) {
      notes.push(`${entry.file}: not unpacked (no unpacker for it)`);
    } else {
      copyFileSync(file, join(folder, name));
    }
  }

  return notes;
}

/** An item fetched and unpacked, its outcome kept. */
export async function fetchItem(item) {
  const id = item.id;
  const folder = join(PROGRAMS, id);
  const downloads = item.source.archiveOrg.downloads;
  const started = Date.now();
  let fetched = 0;

  if (!downloads.length) {
    return keep(id, { fetch: { ok: false, error: 'no download that holds a program' } });
  }

  try {
    for (const entry of downloads) {
      fetched += await download(id, entry);
    }

    const notes = await unpackAll(id, downloads, folder);

    return keep(id, {
      fetch: {
        ok: true,
        fetched,
        unpacked: bytesIn(folder),
        ms: Date.now() - started,
        ...(notes.length ? { notes } : {}),
      },
    });
  } catch (error) {
    return keep(id, {
      fetch: { ok: false, fetched, error: error.message, ms: Date.now() - started },
    });
  }
}

/** The catalog's items. */
export function catalogItems() {
  return JSON.parse(readFileSync(join(ROOT, 'catalog', 'catalog.json'), 'utf8')).items;
}

function status(items) {
  let ok = 0;
  let failed = 0;
  let fetched = 0;
  let unpacked = 0;

  for (const item of items) {
    const fetch = stateOf(item.id).fetch;

    if (fetch?.ok) {
      ok++;
      unpacked += fetch.unpacked;
    } else if (fetch) {
      failed++;
    }

    fetched += fetch?.fetched ?? 0;
  }

  return { items: items.length, ok, failed, fetched, unpacked };
}

async function main() {
  const args = process.argv.slice(2);
  const items = catalogItems();

  if (args.includes('--status')) {
    console.log(status(items));
    return;
  }

  const ids = args.filter((arg) => !arg.startsWith('--'));
  const retry = args.includes('--retry');
  const chosen = (ids.length ? items.filter((item) => ids.includes(item.id)) : items)
    .filter((item) => ids.length || !stateOf(item.id).fetch?.ok)
    .filter((item) => ids.length || retry || !stateOf(item.id).fetch)
    .sort((a, b) => a.size - b.size);
  let unpacked = status(items).unpacked;
  let done = 0;
  const started = Date.now();
  let stop = false;

  console.error(
    `${chosen.length} items to fetch, ${chosen.reduce((sum, item) => sum + item.size, 0)} bytes`
  );

  const worker = async () => {
    while (chosen.length && !stop) {
      const item = chosen.shift();
      const state = await fetchItem(item);

      unpacked += state.fetch.unpacked ?? 0;
      done++;

      if (!state.fetch.ok) {
        console.error(`${item.id}: ${state.fetch.error}`);
      }

      if (done % 50 === 0) {
        console.error(
          `${done} done, ${chosen.length} left, ${Math.round(unpacked / 1e6)} MB unpacked, ${Math.round((Date.now() - started) / 1000)} s`
        );
      }

      if (unpacked > LIMIT) {
        stop = true;
        console.error(`stopped: ${unpacked} bytes unpacked, past ${LIMIT}`);
      }
    }
  };

  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.error(`done in ${Math.round((Date.now() - started) / 1000)} s`, status(items));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
