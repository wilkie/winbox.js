/**
 * The compatibility table: every program of the catalog (`catalog/catalog.json`),
 * what the first pass found when it ran it (`catalog/results.json`, and the
 * work queue's links, `catalog/queue.json`), what people found
 * (`catalog/ratings/<id>.json`), and its links (archive.org, MobyGames,
 * Wikipedia). The design is `kb/guides/compatibility.md`.
 *
 * The results and the queue are written by the first pass, and may be
 * missing or partial while it runs: an entry without a result is shown as
 * not yet run. Ratings are files people add by pull request; each is held to
 * `validateRatings` when the site builds, so the pre-commit hook refuses one
 * that is malformed.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Target, Targets } from './markup.js';
import { escape } from './pages.js';

/** A rating, best to worst: what a person found when they used the program. */
export const RATINGS = ['perfect', 'playable', 'runs with problems', 'fails'] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_MEANING: Record<Rating, string> = {
  perfect: 'no difference from Windows that the person saw',
  playable: 'usable from start to end, with small differences (a colour, a sound, timing)',
  'runs with problems': 'it runs, but something that matters is wrong or missing',
  fails: 'it cannot be used',
};

/** One rating, as a file of `catalog/ratings/` holds it. */
export interface RatingRecord {
  rating: Rating;
  /** The WinBox commit the program was used on: 7 to 40 hexadecimal digits. */
  commit: string;
  /** When: `YYYY-MM-DD`. */
  date: string;
  note: string;
  /** A name or handle the rater chooses; never an address. */
  rater?: string;
  /** The display it ran on: `vga` (16 colours) or `vga256`. */
  display?: 'vga' | 'vga256';
  mode?: 'standard' | 'enhanced';
}

const RATING_FIELDS = new Set(['rating', 'commit', 'date', 'note', 'rater', 'display', 'mode']);

/** The first pass's record of one program (`kb/guides/compatibility.md`, "What is committed"). */
export interface Result {
  id: string;
  status: string;
  signature?: string;
  needs?: string[] | Record<string, unknown>;
  /** The runtimes the first pass placed in `WINDOWS\SYSTEM` for it (`catalog/runtimes.json`). */
  runtimes?: string[];
  commit?: string;
  date?: string;
  /** A reference to the kb page or probe that explains it: `topic:win386`, `fn:USER.Foo`, `probe:name`. */
  explained?: string;
}

interface CatalogEntry {
  id: string;
  title: string;
  publisher: string | null;
  year: number | null;
  kind: string;
  form: string;
  needs?: string[] | Record<string, unknown>;
  source?: { archiveOrg?: { identifier: string } };
}

export interface Compatibility {
  entries: CatalogEntry[];
  results: Map<string, Result>;
  ratings: Map<string, RatingRecord[]>;
  mobygames: Map<string, { id: number; url: string }>;
  wikipedia: Map<
    string,
    { title: string; year: number | null; companies: string[]; article: string | null }
  >;
  wikipediaSource: { url: string; revision: number } | null;
  mobygamesAsked: string | null;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Whatever shape the first pass writes its records in -- `{ items: [...] }`,
 * an array, an object keyed by id, or a record a line -- as a map by id.
 */
export function resultsOf(text: string): Map<string, Result> {
  const results = new Map<string, Result>();
  const trimmed = text.trim();

  if (!trimmed) {
    return results;
  }

  let rows: unknown[];

  try {
    const data = JSON.parse(trimmed);
    rows = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.results)
          ? data.results
          : Object.entries(data.items ?? data.results ?? data)
              .filter(([, row]) => row && typeof row === 'object' && 'status' in (row as object))
              .map(([id, row]) => ({ id, ...(row as object) }));
  } catch {
    rows = trimmed
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
  }

  for (const row of rows as Result[]) {
    if (row && typeof row.id === 'string' && typeof row.status === 'string') {
      results.set(row.id, row);
    }
  }

  return results;
}

/**
 * The work queue's links: a group of programs sharing a signature may name
 * the page or probe that explains it (`page`, `probe`, `explained` or `kb`,
 * a reference as a kb page writes one). Its programs are `ids` or
 * `programs`, as ids or as records with one.
 */
export function queueLinksOf(data: unknown): Map<string, string> {
  const links = new Map<string, string>();
  const groups = Array.isArray(data)
    ? data
    : ((data as { groups?: unknown[]; queue?: unknown[] })?.groups ??
      (data as { queue?: unknown[] })?.queue ??
      []);

  for (const group of groups as Record<string, unknown>[]) {
    const reference = [group.explained, group.page, group.kb, group.probe]
      .map((value, at) =>
        at === 3 && typeof value === 'string' && !value.includes(':') ? `probe:${value}` : value
      )
      .find((value) => typeof value === 'string' && value.includes(':')) as string | undefined;
    const members = (group.ids ?? group.programs ?? []) as (string | { id?: string })[];

    if (!reference) {
      continue;
    }

    for (const member of members) {
      const id = typeof member === 'string' ? member : member?.id;

      if (id) {
        links.set(id, reference);
      }
    }
  }

  return links;
}

/** Every problem with one file of ratings, as messages; none if it is sound. */
export function validateRatings(
  file: string,
  data: unknown,
  ids: Set<string>,
  today = new Date()
): string[] {
  const errors: string[] = [];
  const id = file.replace(/\.json$/, '');

  if (!file.endsWith('.json')) {
    return [`${file}: a ratings file is <catalog id>.json`];
  }

  if (!ids.has(id)) {
    errors.push(`${file}: ${id} is not an id in catalog/catalog.json`);
  }

  const list = (data as { ratings?: unknown })?.ratings;

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some((key) => key !== 'ratings')
  ) {
    errors.push(`${file}: the file is an object with one field, "ratings"`);
  }

  if (!Array.isArray(list) || !list.length) {
    errors.push(`${file}: "ratings" is a list of one rating or more`);
    return errors;
  }

  list.forEach((rating: Record<string, unknown>, at) => {
    const where = `${file}: rating ${at + 1}`;

    if (!rating || typeof rating !== 'object' || Array.isArray(rating)) {
      errors.push(`${where} is not an object`);
      return;
    }

    for (const key of Object.keys(rating)) {
      if (!RATING_FIELDS.has(key)) {
        errors.push(`${where}: "${key}" is not a field of a rating`);
      }
    }

    if (!RATINGS.includes(rating.rating as Rating)) {
      errors.push(`${where}: "rating" is one of ${RATINGS.map((r) => `"${r}"`).join(', ')}`);
    }

    if (typeof rating.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(rating.commit)) {
      errors.push(
        `${where}: "commit" is the WinBox commit used, 7 to 40 hexadecimal digits in small letters`
      );
    }

    const date = typeof rating.date === 'string' ? rating.date : '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;

    if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
      errors.push(`${where}: "date" is a day, YYYY-MM-DD`);
    } else if (day.getTime() > today.getTime() + 86_400_000) {
      errors.push(`${where}: "date" ${date} is after today`);
    }

    if (typeof rating.note !== 'string' || !rating.note.trim() || rating.note.length > 1000) {
      errors.push(`${where}: "note" says what was tried and seen, 1 to 1,000 characters`);
    }

    if (rating.rater !== undefined) {
      if (typeof rating.rater !== 'string' || !rating.rater.trim() || rating.rater.length > 60) {
        errors.push(`${where}: "rater" is a name or handle of 1 to 60 characters, or left out`);
      } else if (rating.rater.includes('@') && /\S@\S/.test(rating.rater)) {
        errors.push(`${where}: "rater" looks like an email address; a name or handle only`);
      }
    }

    if (rating.display !== undefined && rating.display !== 'vga' && rating.display !== 'vga256') {
      errors.push(`${where}: "display" is "vga" or "vga256", or left out`);
    }

    if (rating.mode !== undefined && rating.mode !== 'standard' && rating.mode !== 'enhanced') {
      errors.push(`${where}: "mode" is "standard" or "enhanced", or left out`);
    }
  });

  return errors;
}

/** Read everything the table is built from. Throws if a ratings file is malformed. */
export function readCompatibility(root: string): Compatibility | null {
  const dir = join(root, 'catalog');
  const catalogFile = join(dir, 'catalog.json');

  if (!existsSync(catalogFile)) {
    return null;
  }

  const entries = (readJson(catalogFile).items as CatalogEntry[]).slice();
  const ids = new Set(entries.map((entry) => entry.id));

  const resultsFile = join(dir, 'results.json');
  const results = existsSync(resultsFile)
    ? resultsOf(readFileSync(resultsFile, 'utf8'))
    : new Map<string, Result>();

  const queueFile = join(dir, 'queue.json');

  if (existsSync(queueFile)) {
    for (const [id, reference] of queueLinksOf(readJson(queueFile))) {
      const result = results.get(id);

      if (result && !result.explained) {
        result.explained = reference;
      }
    }
  }

  const ratings = new Map<string, RatingRecord[]>();
  const ratingsDir = join(dir, 'ratings');
  const errors: string[] = [];

  if (existsSync(ratingsDir)) {
    for (const file of readdirSync(ratingsDir).sort()) {
      if (file === 'README.md') {
        continue;
      }

      let data: unknown;

      try {
        data = readJson(join(ratingsDir, file));
      } catch (error) {
        errors.push(`catalog/ratings/${file}: not JSON (${(error as Error).message})`);
        continue;
      }

      const problems = validateRatings(file, data, ids);
      errors.push(...problems.map((problem) => `catalog/ratings/${problem}`));

      if (!problems.length) {
        ratings.set(file.replace(/\.json$/, ''), (data as { ratings: RatingRecord[] }).ratings);
      }
    }
  }

  if (errors.length) {
    throw new Error(`ratings that are not sound:\n  ${errors.join('\n  ')}`);
  }

  const mobyFile = join(dir, 'mobygames.json');
  const moby = existsSync(mobyFile) ? readJson(mobyFile) : null;
  const wikiFile = join(dir, 'wikipedia.json');
  const wiki = existsSync(wikiFile) ? readJson(wikiFile) : null;

  return {
    entries,
    results,
    ratings,
    mobygames: new Map(Object.entries(moby?.items ?? {})),
    mobygamesAsked: moby?.asked ?? null,
    wikipedia: new Map(Object.entries(wiki?.items ?? {})),
    wikipediaSource: wiki?.source ?? null,
  };
}

/** The rating shown: the latest by date, then the last in the file. */
export function latestRating(list: RatingRecord[] | undefined) {
  return (
    list?.reduce<RatingRecord | null>(
      (best, rating) => (!best || rating.date >= best.date ? rating : best),
      null
    ) ?? null
  );
}

/** A status's words, for a person: the first pass's statuses (`kb/guides/compatibility.md`). */
export const STATUS_LABEL: Record<string, string> = {
  idle: 'starts',
  box: 'its own box',
  running: 'running',
  missing: 'missing function',
  unsupported: 'unsupported',
  fault: 'fault',
  ended: 'ended',
  win32s: 'Win32',
  library: 'library missing',
  installer: 'installer',
  fetch: 'fetch failed',
  'not-windows': 'not Windows',
};

/** The kb page that explains a status where the status alone names one. */
function explanationOf(result: Result, targets: Targets): Target | undefined {
  const reference = result.explained;

  if (reference) {
    const [kind, ...rest] = reference.split(':');
    const name = rest.join(':');
    const map = {
      fn: targets.functions,
      topic: targets.topics,
      format: targets.formats,
      guide: targets.guides,
      probe: targets.probes,
    }[kind];
    const found = map?.get(kind === 'fn' ? name.toUpperCase() : name);

    if (found) {
      return found;
    }
  }

  if (result.status === 'missing' && result.signature) {
    return targets.functions.get(result.signature.trim().toUpperCase());
  }

  if (result.status === 'win32s') {
    return targets.topics.get('win32s');
  }

  return undefined;
}

const needsOf = (value: Result['needs'] | CatalogEntry['needs']) =>
  !value
    ? []
    : Array.isArray(value)
      ? value.map(String)
      : Object.entries(value)
          .filter(
            ([, v]) =>
              v !== false && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)
          )
          .map(([k, v]) => (v === true ? k : `${k}: ${[v].flat().join(', ')}`));

export interface TableOptions {
  targets: Targets;
  /** A commit's page, or null where the repository's host is not known. */
  commitUrl: (sha: string) => string | null;
  /** From the page to the site's root. */
  up: string;
}

/** The table's rows, and the counts above it. */
export function renderTable(data: Compatibility, options: TableOptions) {
  const { targets, commitUrl, up } = options;
  const counts = { run: 0, rated: 0, moby: 0, wiki: 0 };
  const statuses = new Map<string, number>();

  const entries = data.entries
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));

  const rows = entries.map((entry) => {
    const result = data.results.get(entry.id);
    const rating = latestRating(data.ratings.get(entry.id));
    const moby = data.mobygames.get(entry.id);
    const wiki = data.wikipedia.get(entry.id);
    const status = result?.status ?? 'not run';

    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    counts.run += result ? 1 : 0;
    counts.rated += rating ? 1 : 0;
    counts.moby += moby ? 1 : 0;
    counts.wiki += wiki ? 1 : 0;

    const year = entry.year ?? wiki?.year ?? null;
    const yearCell =
      year === null
        ? ''
        : entry.year
          ? String(year)
          : `${year}<abbr class="from" title="from Wikipedia">W</abbr>`;
    const publisher = entry.publisher ?? wiki?.companies.join(', ') ?? '';
    const publisherCell = entry.publisher
      ? escape(publisher)
      : publisher
        ? `${escape(publisher)}<abbr class="from" title="from Wikipedia">W</abbr>`
        : '';

    const needs = needsOf(result?.needs ?? entry.needs);
    const commit = (sha: string | undefined) => {
      if (!sha) {
        return '';
      }

      const url = commitUrl(sha);
      const text = `<code>${escape(sha.slice(0, 8))}</code>`;
      return url ? `<a href="${escape(url)}">${text}</a>` : text;
    };

    const explanation = result ? explanationOf(result, targets) : undefined;
    const statusCell = result
      ? `<span class="status s-${escape(status)}">${escape(STATUS_LABEL[status] ?? status)}</span>${
          result.runtimes?.length
            ? ` <span class="note">with ${escape(result.runtimes.join(' and '))}</span>`
            : ''
        }${result.signature ? `<br><span class="sig">${escape(result.signature)}</span>` : ''}${result.commit ? `<br><span class="note">on ${commit(result.commit)}${result.date ? `, ${escape(result.date)}` : ''}</span>` : ''}`
      : '<span class="note nowrap">not run yet</span>';

    const ratingCell = rating
      ? `<span class="rating r-${RATINGS.indexOf(rating.rating)}">${escape(rating.rating)}</span><br><span class="note">on ${commit(rating.commit)}, ${escape(rating.date)}${
          rating.rater ? `, ${escape(rating.rater)}` : ''
        }</span>`
      : '';

    const identifier = entry.source?.archiveOrg?.identifier ?? entry.id;
    const links = [
      `<a href="https://archive.org/details/${encodeURIComponent(identifier)}" aria-label="${escape(entry.title)} on archive.org">archive.org</a>`,
      moby
        ? `<a href="${escape(moby.url)}" aria-label="${escape(entry.title)} on MobyGames">MobyGames</a>`
        : '',
      wiki?.article
        ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.article.replaceAll(' ', '_'))}" aria-label="${escape(entry.title)} on Wikipedia">Wikipedia</a>`
        : '',
      explanation
        ? `<a href="${up}${explanation.url}" aria-label="Why ${escape(entry.title)} stops: ${escape(explanation.title)}">why</a>`
        : '',
    ].filter(Boolean);

    /* What the script sorts and filters by, so it need not read the cells. */
    const attributes = [
      ['title', entry.title.toLowerCase()],
      ['year', year ?? ''],
      ['publisher', publisher.toLowerCase()],
      ['kind', entry.kind],
      ['status', status],
      ['rating', rating ? RATINGS.indexOf(rating.rating) : 9],
      ['needs', needs.join(' ').toLowerCase()],
    ]
      .map(([name, value]) => `data-${name}="${escape(String(value))}"`)
      .join(' ');

    return `<tr ${attributes}><th scope="row">${escape(entry.title)}</th><td class="num">${yearCell}</td><td>${publisherCell}</td><td>${escape(entry.kind)}</td><td>${escape(needs.join(', '))}</td><td>${statusCell}</td><td>${ratingCell}</td><td class="links">${links.join(' ')}</td></tr>`;
  });

  return { rows, counts, statuses, total: entries.length };
}
