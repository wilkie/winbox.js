/**
 * The programs left out of the compatibility list: the items archive.org
 * files under Windows 3.x whose download holds no Windows 3.x program (a DOS
 * program, a Flash movie, a Commodore 64 tape, ...), kept in
 * `catalog/excluded.json` with the reason each is out. The owner's decision
 * of 2026-11-17, in kb/guides/compatibility.md.
 *
 * Every tool that reads the catalog leaves these out: `catalog.mjs` does not
 * write them into `catalog/catalog.json` (so archive.org's listing does not
 * bring them back), `fetch.mjs`'s `catalogItems` and `pass.mjs --results`
 * skip them, and the table in kb/ is made from those files.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The list, `catalog/excluded.json`. */
export const EXCLUDED = join(ROOT, 'catalog', 'excluded.json');

/** The excluded items: `{ id, title, reason, signature, date }` each. */
export function excluded() {
  return JSON.parse(readFileSync(EXCLUDED, 'utf8')).items;
}

/** The excluded items' identifiers. */
export function excludedIds() {
  return new Set(excluded().map((entry) => entry.id));
}

/** The entries (anything with an `id`) that are not excluded. */
export function withoutExcluded(entries) {
  const ids = excludedIds();

  return entries.filter((entry) => !ids.has(entry.id));
}
