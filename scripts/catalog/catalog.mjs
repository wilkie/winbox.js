#!/usr/bin/env node
/**
 * The compatibility catalog's first pass: every item of archive.org's
 * Windows 3.x software library, from its public advanced-search and
 * metadata APIs, written as `catalog/catalog.json`, an entry an item.
 * Metadata only: no program's files are fetched here, and sizes come from
 * the items' file lists. The design is `kb/guides/compatibility.md`.
 *
 *   node scripts/catalog/catalog.mjs           # list, fetch what is not cached, write, count
 *   node scripts/catalog/catalog.mjs --counts  # count the catalog already written
 *   node scripts/catalog/catalog.mjs --titles  # choose the titles again (`titles.mjs`), and write
 *
 * Each item's metadata is kept in `corpus/cache/catalog/<identifier>.json`
 * (gitignored, as the rest of `corpus/` is), so a second run asks
 * archive.org for nothing it has. The uploader's address, which an item's
 * metadata carries, is dropped before it is kept.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { corrections, withTitle } from './titles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog');
const OUT = join(ROOT, 'catalog', 'catalog.json');

/** Who is asking: the project, and no one's address. */
const USER_AGENT = 'WinBox catalog';

/** Between two requests to archive.org, in milliseconds. */
const DELAY = 500;

/**
 * The software library's Windows 3.x collections. The games are one; the
 * applications are spread over productivity and desktop toys, with the
 * showcase and the shareware collections crossing both, and a few items in
 * the parent alone. WinHelp's collection is help files, not programs, and
 * is left out.
 */
export const PARENT = 'softwarelibrary_win3';
export const COLLECTIONS = [
  'softwarelibrary_win3_games',
  'softwarelibrary_win3_productivity',
  'softwarelibrary_win3_desktoptoys',
  'softwarelibrary_win3_showcase',
  'softwarelibrary_win3_shareware',
];
const LEFT_OUT = ['softwarelibrary_win3_winhelp'];

/** The extensions of a disc's image. */
const DISC = /\.(iso|cue|bin|img|mdf|mds|nrg|ccd|chd|toast)$/i;
/** The extensions of a download that holds a program. */
const PROGRAM = /\.(zip|7z|rar|lzh|arj|exe|ima|vfd|dsk)$/i;
/** A program to run that installs: SETUP, INSTALL, INST and their like. */
const INSTALLER = /^(_?setup|install|inst|instal)[^\\/]*\.exe$/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

    if (response.ok) {
      return response.json();
    }

    if (attempt === 3) {
      throw new Error(`${url} answered ${response.status}`);
    }

    await wait(DELAY * 10 * attempt);
  }
}

/** Every item's identifier, from the advanced search, in one page. */
async function identifiers() {
  const query = [
    `collection:${PARENT}`,
    ...LEFT_OUT.map((collection) => `NOT collection:${collection}`),
  ].join(' AND ');
  const url =
    'https://archive.org/advancedsearch.php?' +
    new URLSearchParams({
      q: query,
      'fl[]': 'identifier',
      'sort[]': 'identifier asc',
      rows: '10000',
      output: 'json',
    });
  const found = await getJson(url);

  return found.response.docs.map((doc) => doc.identifier);
}

/** An item's metadata, from the cache or archive.org. */
async function metadata(identifier) {
  const file = join(CACHE, `${identifier}.json`);

  if (existsSync(file)) {
    return { item: JSON.parse(readFileSync(file, 'utf8')), fetched: false };
  }

  const item = await getJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);

  /* Kept without the uploader's address, which is no one's business here. */
  if (item.metadata) {
    delete item.metadata.uploader;
  }

  writeFileSync(file, JSON.stringify({ metadata: item.metadata, files: item.files }));
  return { item, fetched: true };
}

/** A field as one string: archive.org's fields may be a list. */
function text(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return Array.isArray(value) ? value.join('; ') : String(value);
}

/** The year an item names: its year, else its date's. */
function yearOf(meta) {
  const match = /\b(19[89]\d|20\d\d)\b/.exec(text(meta.year) ?? text(meta.date) ?? '');

  return match ? Number(match[1]) : null;
}

/**
 * The program emulator_start names: `d:\runapp SETUP.EXE` is SETUP.EXE, as
 * the item's DOSBox runs it from its D:.
 */
function runOf(meta) {
  const start = text(meta.emulator_start);

  if (!start) {
    return null;
  }

  /* The first word naming a program after runapp, else the last word. */
  const words = start.trim().split(/\s+/);
  const program = words.slice(1).find((word) => /\.(exe|com|bat|pif)$/i.test(word));

  return program ?? words[words.length - 1];
}

/** The downloads that hold the program: its original files, by extension. */
function programFiles(files) {
  return files
    .filter(
      (file) => file.source === 'original' && (DISC.test(file.name) || PROGRAM.test(file.name))
    )
    .map((file) => ({
      file: file.name,
      size: Number(file.size ?? 0),
      sha1: file.sha1 ?? null,
      md5: file.md5 ?? null,
    }));
}

/**
 * What the item is: a disc's image, a program to install (its start is a
 * setup), loose files run as they are, or none of those (no download that
 * holds a program, or not a DOSBox item: archive.org's collection has
 * Flash and other emulators' items too).
 */
function formOf(meta, downloads, run) {
  if (!/^dosbox/.test(text(meta.emulator) ?? '') || !downloads.length) {
    return 'none';
  }

  if (downloads.some((download) => DISC.test(download.file))) {
    return 'disc';
  }

  if (run && INSTALLER.test(run.split(/[\\/]/).pop())) {
    return 'installer';
  }

  return 'loose';
}

/** An item as the catalog keeps it. */
export function entryOf(identifier, item) {
  const meta = item.metadata ?? {};
  const collections = [meta.collection ?? []].flat();
  const downloads = programFiles(item.files ?? []);
  const run = runOf(meta);

  return {
    id: identifier,
    title: text(meta.title),
    publisher: text(meta.publisher) ?? text(meta.creator),
    year: yearOf(meta),
    kind: collections.includes('softwarelibrary_win3_games') ? 'game' : 'application',
    collections: collections
      .filter((collection) => collection.startsWith(`${PARENT}_`))
      .map((collection) => collection.slice(PARENT.length + 1)),
    form: formOf(meta, downloads, run),
    emulator: text(meta.emulator),
    run,
    source: { archiveOrg: { identifier, downloads } },
    size: downloads.reduce((total, download) => total + download.size, 0),
    sha256: null,
  };
}

/** The counts the design page gives. */
export function counts(catalog) {
  const byCollection = {};
  const byForm = {};
  let bytes = 0;

  for (const entry of catalog) {
    for (const collection of entry.collections.length ? entry.collections : ['(parent alone)']) {
      byCollection[collection] = (byCollection[collection] ?? 0) + 1;
    }

    byForm[entry.form] = (byForm[entry.form] ?? 0) + 1;
    bytes += entry.size;
  }

  const of = (kind) => catalog.filter((entry) => entry.kind === kind);
  const bytesOf = (entries) => entries.reduce((total, entry) => total + entry.size, 0);

  return {
    items: catalog.length,
    byKind: { game: of('game').length, application: of('application').length },
    byCollection,
    byForm,
    bytes,
    bytesByKind: { game: bytesOf(of('game')), application: bytesOf(of('application')) },
    withYear: catalog.filter((entry) => entry.year).length,
    withPublisher: catalog.filter((entry) => entry.publisher).length,
    withBoth: catalog.filter((entry) => entry.year && entry.publisher).length,
    byTitleSource: catalog.reduce(
      (by, entry) => ({ ...by, [entry.titleSource]: (by[entry.titleSource] ?? 0) + 1 }),
      {}
    ),
  };
}

function print(summary) {
  const gib = (bytes) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;

  console.log(
    `items: ${summary.items} (games ${summary.byKind.game}, applications ${summary.byKind.application})`
  );

  for (const [collection, count] of Object.entries(summary.byCollection)) {
    console.log(`  ${collection}: ${count}`);
  }

  console.log(`forms: ${JSON.stringify(summary.byForm)}`);
  console.log(
    `bytes: ${summary.bytes} (${gib(summary.bytes)}; games ${gib(summary.bytesByKind.game)}, applications ${gib(summary.bytesByKind.application)})`
  );
  console.log(
    `with a year: ${summary.withYear}, a publisher: ${summary.withPublisher}, both: ${summary.withBoth}`
  );
  console.log(`titles by source: ${JSON.stringify(summary.byTitleSource)}`);
}

/** The catalog written: an entry a line, sorted by identifier. */
function write(catalog) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `{\n"about": ${JSON.stringify(
      "Windows 3.x programs published in archive.org's software library, metadata only: written by scripts/catalog/catalog.mjs; the design is kb/guides/compatibility.md. sha256 is filled when a program is fetched. title is chosen from the candidates in titles (scripts/catalog/titles.mjs), titleSource naming which; titles.archiveOrg is archive.org's title as it has it."
    )},\n"items": [\n${catalog.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n}\n`
  );
}

async function main() {
  if (process.argv.includes('--counts')) {
    print(counts(JSON.parse(readFileSync(OUT, 'utf8')).items));
    return;
  }

  if (process.argv.includes('--titles')) {
    const fixes = corrections();

    write(JSON.parse(readFileSync(OUT, 'utf8')).items.map((entry) => withTitle(entry, fixes)));
    return;
  }

  mkdirSync(CACHE, { recursive: true });

  const ids = await identifiers();
  const catalog = [];
  const fixes = corrections();
  let failed = 0;

  console.error(`${ids.length} items`);

  for (const [index, identifier] of ids.entries()) {
    try {
      const { item, fetched } = await metadata(identifier);

      catalog.push(withTitle(entryOf(identifier, item), fixes));

      if (fetched) {
        await wait(DELAY);
      }
    } catch (error) {
      failed++;
      console.error(`${identifier}: ${error.message}`);
    }

    if (index % 100 === 99) {
      console.error(`${index + 1} of ${ids.length}`);
    }
  }

  write(catalog);
  print(counts(catalog));

  if (failed) {
    console.error(`${failed} items not read`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
