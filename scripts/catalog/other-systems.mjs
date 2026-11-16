#!/usr/bin/env node
/**
 * Sizes the audience beyond Windows 3.1: how many items archive.org
 * publishes for Windows 95 and 98, Win32s and OS/2, and how many bytes
 * they hold, from its public search API, written as
 * `catalog/other-systems.json`. Metadata only: no item's files are
 * fetched, and no identifier is kept, only counts. The design is
 * `kb/guides/beyond-windows-31.md`.
 *
 *   node scripts/catalog/other-systems.mjs
 *
 * archive.org has a curated software library for Windows 3.x
 * (`softwarelibrary_win3`) and none for the systems after it: no
 * `softwarelibrary_win95`, no OS/2 collection. Their software is spread
 * over the CD-ROM and vintage software collections, so each group here is
 * a search of the items' subjects and titles, not a collection, and counts
 * what uploaders called it. The Windows 3.x library is searched the same
 * way, by its collection, to set the others beside it.
 *
 * `bytes` is the sum of archive.org's `item_size`, which counts every file
 * of an item, derived files and screenshots among them; the Windows 3.x
 * catalog's `size` counts only the downloads that hold a program
 * (`catalog.mjs`), so the two differ for the same items.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'catalog', 'other-systems.json');
const RESULTS = join(ROOT, 'catalog', 'results.json');

/** Who is asking: the project, and no one's address. */
const USER_AGENT = 'WinBox catalog';

/** Between two requests to archive.org, in milliseconds. */
const DELAY = 1000;

/** How many of an item's collections each group lists, the largest first. */
const TOP = 12;

/** A query's terms for a name, in an item's subjects or its title. */
const named = (...names) =>
  names.flatMap((name) => [`subject:"${name}"`, `title:"${name}"`]).join(' OR ');

/** Each group: its name, the search, and what it holds. */
const GROUPS = [
  {
    group: 'windows-3x-library',
    query: 'collection:softwarelibrary_win3',
    about:
      "archive.org's Software Library: Windows 3.x, every item, the WinHelp collection included: the catalog's source, for comparison.",
  },
  {
    group: 'windows-95',
    query: `mediatype:software AND (${named('Windows 95', 'Win95')})`,
    about: 'Software items whose subject or title names Windows 95.',
  },
  {
    group: 'windows-98',
    query: `mediatype:software AND (${named('Windows 98', 'Win98')})`,
    about: 'Software items whose subject or title names Windows 98.',
  },
  {
    group: 'windows-9x',
    query: `mediatype:software AND (${named('Windows 95', 'Win95', 'Windows 98', 'Win98', 'Windows 9x', 'Win9x')})`,
    about: 'The two above and "Windows 9x", each item once.',
  },
  {
    group: 'win32s',
    query: `mediatype:software AND (${named('Win32s')})`,
    about: 'Software items whose subject or title names Win32s.',
  },
  {
    group: 'os2',
    query: `mediatype:software AND (${named('OS/2', 'OS2', 'OS/2 Warp', 'eComStation', 'ArcaOS')})`,
    about:
      'Software items whose subject or title names OS/2 (or its successors eComStation and ArcaOS); archive.org has no OS/2 collection.',
  },
];

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

/** A field as a list: archive.org's fields may be one value or several. */
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Every item a query finds, through the scrape API's pages. */
async function scrape(query) {
  const items = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'identifier,item_size,collection,emulator,year',
      count: '10000',
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const page = await getJson(`https://archive.org/services/search/v1/scrape?${params}`);

    items.push(...(page.items ?? []));
    cursor = page.cursor ?? null;
    await wait(DELAY);
  } while (cursor);

  return items;
}

/** Counts by a key, the largest first, the first `top` of them. */
function tally(keys, top) {
  const counts = new Map();

  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, top));
}

/**
 * The Windows 3.x catalog's own Win32 programs, from the first pass's
 * results: the items whose program is a PE file (status `win32s`), and
 * those whose needs say Win32s at all (a PE program, or Win32s' files in
 * the download), by kind and by the status the pass gave them.
 */
function win32sInCatalog() {
  const { items } = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const needing = items.filter((item) => item.needs?.flags?.includes('win32s'));

  return {
    items: items.length,
    statusWin32s: items.filter((item) => item.status === 'win32s').length,
    needsWin32s: needing.length,
    byKind: tally(
      needing.map((item) => item.kind),
      TOP
    ),
    byStatus: tally(
      needing.map((item) => item.status),
      TOP
    ),
  };
}

const date = new Date().toISOString().slice(0, 10);
const groups = [];

for (const { group, query, about } of GROUPS) {
  const items = await scrape(query);
  const bytes = items.reduce((sum, item) => sum + (Number(item.item_size) || 0), 0);
  const emulated = items.filter((item) => list(item.emulator).length > 0);

  groups.push({
    group,
    about,
    query,
    items: items.length,
    bytes,
    /* Items archive.org runs in the browser, by its emulator. */
    emulator: tally(
      emulated.flatMap((item) => list(item.emulator)),
      TOP
    ),
    /* Favourites lists are people's bookmarks, not collections of the items. */
    collections: tally(
      items.flatMap((item) => list(item.collection).filter((name) => !name.startsWith('fav-'))),
      TOP
    ),
  });
  console.log(`${group}: ${items.length} items, ${(bytes / 1e9).toFixed(1)} GB`);
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      about:
        "Items archive.org publishes for the systems beyond Windows 3.1, metadata only: counts and bytes (the sum of item_size, derived files included) by a search of subjects and titles, for sizing the audience (kb/guides/beyond-windows-31.md). Made by scripts/catalog/other-systems.mjs; no identifier is kept. catalog counts the Windows 3.x catalog's items that need Win32s, from catalog/results.json.",
      date,
      catalog: win32sInCatalog(),
      groups,
    },
    null,
    1
  )}\n`
);
