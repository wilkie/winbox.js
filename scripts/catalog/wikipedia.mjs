#!/usr/bin/env node
/**
 * Wikipedia's "List of Windows 3.x games" matched against the catalog, as a
 * free cross-check of titles, years and companies (`match.mjs` decides).
 * The list is read as wikitext through the MediaWiki API, one request, with
 * the User-Agent "WinBox catalog"; the revision read is kept with what is
 * written, so the facts can be traced to it. Wikipedia's text is CC BY-SA
 * 4.0: only the facts of a row (its title, year and companies) are kept,
 * attributed to the page and its revision. The design is
 * `kb/guides/compatibility.md`, "Matching".
 *
 *   node scripts/catalog/wikipedia.mjs           # fetch the list (once), match, write catalog/wikipedia.json
 *   node scripts/catalog/wikipedia.mjs --fetch   # fetch the list again
 *
 * The wikitext is cached in `corpus/cache/catalog/wikipedia/` (gitignored).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { linesOf, verdictOf } from './match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog', 'wikipedia');
const CATALOG = join(ROOT, 'catalog', 'catalog.json');
const OUT = join(ROOT, 'catalog', 'wikipedia.json');

const PAGE = 'List of Windows 3.x games';
const USER_AGENT = 'WinBox catalog';

async function fetchList() {
  const url = new URL('https://en.wikipedia.org/w/api.php');

  for (const [key, value] of Object.entries({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content|ids|timestamp',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
    titles: PAGE,
  })) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (!response.ok) {
    throw new Error(`Wikipedia answered ${response.status}`);
  }

  const revision = (await response.json()).query.pages[0].revisions[0];

  return {
    revision: revision.revid,
    timestamp: revision.timestamp,
    wikitext: revision.slots.main.content,
  };
}

/** A cell's text, its markup taken off: links by what they show, templates and references dropped. */
export function plain(cell) {
  return cell
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{(?:sort|sortname)\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, '$1 $2')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\S+ ([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The article a cell links to first, if any. */
const articleOf = (cell) => cell.match(/\[\[([^|\]#]+)/)?.[1]?.trim() ?? null;

/**
 * The list's rows: each table's rows after its header, a title, a year (the
 * first that the release date names) and the developers and publishers,
 * which the list keeps in one column.
 */
export function rowsOf(wikitext) {
  const rows = [];

  for (const table of wikitext.split(/\n\{\|/).slice(1)) {
    const body = table.split(/\n\|\}/)[0];

    for (const row of body.split(/\n\|-[^\n]*/).slice(1)) {
      const text = row.trim();

      if (!text.startsWith('|') || text.startsWith('|+')) {
        continue;
      }

      const cells = text
        .replace(/^\|/, '')
        .split(/\|\||\n\|/)
        .map((cell) => cell.replace(/^\s*(?:style|align|rowspan|colspan)="[^"]*"\s*\|/, '').trim());

      if (cells.length < 3) {
        continue;
      }

      const title = plain(cells[0]);
      const year = Number(plain(cells[1]).match(/\b(19[89]\d|20[0-2]\d)\b/)?.[1]) || null;
      const companies = plain(cells[2])
        .split(/,|\//)
        .map((name) => name.trim())
        .filter(Boolean)
        /* "Theatrix Interactive, Inc." is one company, not two. */
        .reduce((names, name) => {
          if (/^(?:inc|ltd|llc|corp|co|gmbh)\.?$/i.test(name) && names.length) {
            names[names.length - 1] += `, ${name}`;
          } else {
            names.push(name);
          }

          return names;
        }, []);

      if (title) {
        rows.push({ title, year, companies, article: articleOf(cells[0]) });
      }
    }
  }

  return rows;
}

const percent = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;

async function main() {
  const args = process.argv.slice(2);
  const cached = join(CACHE, 'list.json');

  if (args.includes('--fetch') || !existsSync(cached)) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, JSON.stringify(await fetchList()));
  }

  const list = JSON.parse(readFileSync(cached, 'utf8'));
  const rows = rowsOf(list.wikitext);
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).items;

  const items = {};
  const review = {};
  const counts = {};
  const used = new Map();

  for (const entry of catalog) {
    const { verdict, best, others } = verdictOf(entry, rows);
    const count = (counts[entry.kind] ??= { confident: 0, ambiguous: 0, none: 0 });
    count[verdict]++;

    const fact = (row) => ({
      title: row.candidate.title,
      year: row.candidate.year,
      companies: row.candidate.companies,
      article: row.candidate.article,
      score: row.score,
    });

    if (verdict === 'confident') {
      items[entry.id] = fact(best);
      used.set(best.candidate, (used.get(best.candidate) ?? 0) + 1);
    } else if (verdict === 'ambiguous') {
      review[entry.id] = {
        title: entry.title,
        year: entry.year,
        candidates: [best, ...others].filter((row) => row.title >= 0.75).map(fact),
      };
    }
  }

  writeFileSync(
    OUT,
    linesOf({
      about:
        'Catalog entries matched to rows of Wikipedia\'s "List of Windows 3.x games" by scripts/catalog/wikipedia.mjs (rules: scripts/catalog/match.mjs, kb/guides/compatibility.md). The facts of each row (title, year, developers and publishers) are from Wikipedia, CC BY-SA 4.0, at the revision named in source. items are confident matches, keyed by catalog id; review are ambiguous ones, for a person to decide.',
      source: {
        page: PAGE,
        url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(PAGE.replaceAll(' ', '_'))}&oldid=${list.revision}`,
        revision: list.revision,
        timestamp: list.timestamp,
        licence: 'CC BY-SA 4.0',
        rows: rows.length,
      },
      counts,
      items,
      review,
    })
  );

  const games = catalog.filter((entry) => entry.kind === 'game').length;
  console.log(`${rows.length} rows of "${PAGE}" (revision ${list.revision}, ${list.timestamp})`);

  for (const [kind, count] of Object.entries(counts)) {
    console.log(
      `${kind}: ${count.confident} confident, ${count.ambiguous} ambiguous, ${count.none} none`
    );
  }

  console.log(
    `rows matched by one entry or more: ${used.size} of ${rows.length} (${percent(used.size, rows.length)}); games matched ${counts.game?.confident ?? 0} of ${games}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
