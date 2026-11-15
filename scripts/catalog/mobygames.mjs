#!/usr/bin/env node
/**
 * The catalog's entries matched to MobyGames' games on Windows 3.x, through
 * its API, by the rules `match.mjs` holds (the same that match Wikipedia's
 * list). The design, and what MobyGames' API terms allow, are
 * `kb/guides/compatibility.md`, "MobyGames".
 *
 *   node scripts/catalog/mobygames.mjs                 # every entry not yet asked about
 *   node scripts/catalog/mobygames.mjs --kind game     # the games only
 *   node scripts/catalog/mobygames.mjs --limit 50      # the next fifty
 *   node scripts/catalog/mobygames.mjs win3_SOLUS ...  # these
 *   node scripts/catalog/mobygames.mjs --write         # match what is cached, write catalog/mobygames.json
 *   node scripts/catalog/mobygames.mjs --purge         # delete the cached answers
 *
 * **The key is private.** It is read from `MOBYGAMES_API_KEY`, else from
 * `~/.config/winbox/mobygames-key`, and goes only into the request's query,
 * as the API requires; no URL with it is ever printed, logged or written,
 * and an error names the endpoint's path alone.
 *
 * **The terms.** One request every five seconds, the non-commercial limit
 * (720 an hour, at most one a second), and a 429 waited out. The API's
 * answers are intermediate copies, kept in `corpus/cache/catalog/mobygames/`
 * (gitignored) only until the matches are reviewed, and deleted with
 * `--purge`. What reaches the repository is a game's id and its MobyGames
 * link, and the match's score and verdict, which are ours: no title, year,
 * company or other content of MobyGames'. Their terms forbid using their
 * content with generative AI without their written consent: this script is
 * for a person to run, not an AI agent.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { linesOf, normalise, titlesOf, verdictOf } from './match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog', 'mobygames');
const CATALOG = join(ROOT, 'catalog', 'catalog.json');
const OUT = join(ROOT, 'catalog', 'mobygames.json');

const API = 'https://api.mobygames.com/v1';
const USER_AGENT = 'WinBox catalog';

/** MobyGames' platforms: Windows 3.x, and Windows, where a game of 1990s Windows is often listed alone. */
export const PLATFORMS = { 'Windows 3.x': 5, Windows: 3 };

/** Between two requests, in milliseconds: the non-commercial limit, 720 an hour. */
const DELAY = 5000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function key() {
  if (process.env.MOBYGAMES_API_KEY) {
    return process.env.MOBYGAMES_API_KEY.trim();
  }

  const file = join(homedir(), '.config', 'winbox', 'mobygames-key');

  if (!existsSync(file)) {
    throw new Error(
      'no MobyGames key: set MOBYGAMES_API_KEY or write ~/.config/winbox/mobygames-key (mode 600)'
    );
  }

  return readFileSync(file, 'utf8').trim();
}

let last = 0;

/** One request: `path` and its query, the key added here and never shown. */
async function get(path, query = {}) {
  for (let attempt = 1; ; attempt++) {
    const since = Date.now() - last;

    if (since < DELAY) {
      await wait(DELAY - since);
    }

    const url = new URL(`${API}${path}`);

    for (const [name, value] of Object.entries(query)) {
      for (const one of [value].flat()) {
        url.searchParams.append(name, String(one));
      }
    }

    url.searchParams.set('api_key', key());
    last = Date.now();

    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

    if (response.ok) {
      return response.json();
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 429 && attempt < 5) {
      await wait(60_000 * attempt);
      continue;
    }

    /* The path alone: the URL holds the key. */
    throw new Error(`MobyGames answered ${response.status} for ${path}`);
  }
}

/**
 * What to ask the title search for: the entry's title without its
 * brackets, its "for Windows" and its version, up to a colon or a spaced
 * dash. The search takes a substring of the title, without case.
 */
export function searchText(title) {
  return String(title)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/:| - | – /)[0]
    .replace(/\b(?:for )?(?:microsoft )?windows(?: 3(?:\.[0-9x]+)?)?\b/gi, ' ')
    .replace(/\b(?:v|ver\.?|version)\s*\d+(?:\.\d+)*[a-z]?\b/gi, ' ')
    .replace(/[™®!?.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
}

/** A game of the search's answer as a candidate: its title, its year on Windows 3.x (else Windows). */
function candidateOf(game, companies) {
  const platform =
    game.platforms?.find((p) => p.platform_id === PLATFORMS['Windows 3.x']) ??
    game.platforms?.find((p) => p.platform_id === PLATFORMS.Windows);

  return {
    id: game.game_id,
    url: game.moby_url,
    title: game.title,
    alternates: (game.alternate_titles ?? []).map((alt) => alt.title),
    platform: platform?.platform_id ?? null,
    year: Number(String(platform?.first_release_date ?? '').slice(0, 4)) || null,
    companies: companies ?? [],
  };
}

/** Every candidate for an entry, each alternate title a candidate of its own. */
const expand = (candidates) =>
  candidates.flatMap((c) => [c, ...c.alternates.map((title) => ({ ...c, title }))]);

/** Ask about one entry, and cache the answers. */
async function ask(entry) {
  const searches = [
    ...new Set(
      titlesOf(entry)
        .map(searchText)
        .filter((t) => normalise(t).length >= 3)
    ),
  ].slice(0, 3);
  const games = new Map();

  for (const title of searches) {
    const answer = await get('/games', {
      title,
      platform: Object.values(PLATFORMS),
      format: 'normal',
      limit: 25,
    });

    for (const game of answer?.games ?? []) {
      games.set(game.game_id, game);
    }
  }

  /* Companies for the best few by title: the release's, on the platform the year came from. */
  let candidates = [...games.values()].map((game) => candidateOf(game));
  const scored = verdictOf(entry, expand(candidates));
  const close = [scored.best, ...scored.others]
    .filter((row) => row && row.title >= 0.9)
    .map((row) => row.candidate)
    .filter((c, at, all) => c.platform && all.findIndex((d) => d.id === c.id) === at)
    .slice(0, 3);

  const companies = {};

  for (const candidate of close) {
    const release = await get(`/games/${candidate.id}/platforms/${candidate.platform}`);
    companies[candidate.id] = [
      ...new Set(
        (release?.releases ?? []).flatMap((r) => (r.companies ?? []).map((c) => c.company_name))
      ),
    ];
  }

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(
    join(CACHE, `${entry.id}.json`),
    JSON.stringify({
      asked: new Date().toISOString(),
      searches,
      games: [...games.values()],
      companies,
    })
  );
}

/** The verdict for an entry from its cached answers. */
function matchOf(entry) {
  const file = join(CACHE, `${entry.id}.json`);

  if (!existsSync(file)) {
    return null;
  }

  const cached = JSON.parse(readFileSync(file, 'utf8'));
  const candidates = cached.games.map((game) => candidateOf(game, cached.companies[game.game_id]));

  return { ...verdictOf(entry, expand(candidates)), asked: cached.asked };
}

function write(catalog) {
  const items = {};
  const review = {};
  const counts = {};
  let oldest = null;

  for (const entry of catalog) {
    const match = matchOf(entry);
    const count = (counts[entry.kind] ??= { confident: 0, ambiguous: 0, none: 0, unasked: 0 });

    if (!match) {
      count.unasked++;
      continue;
    }

    count[match.verdict]++;
    oldest = !oldest || match.asked < oldest ? match.asked : oldest;

    /* Ids and links only, with our score: no content of MobyGames'. */
    const link = (row) => ({
      id: row.candidate.id,
      url: row.candidate.url,
      platform: row.candidate.platform,
      score: row.score,
    });

    if (match.verdict === 'confident') {
      items[entry.id] = link(match.best);
    } else if (match.verdict === 'ambiguous') {
      const rows = [match.best, ...match.others].filter((row) => row.title >= 0.75);
      review[entry.id] = rows
        .map(link)
        .filter((row, at, all) => all.findIndex((r) => r.id === row.id) === at);
    }
  }

  writeFileSync(
    OUT,
    linesOf({
      about:
        'Catalog entries matched to MobyGames games by scripts/catalog/mobygames.mjs (rules: scripts/catalog/match.mjs; terms and design: kb/guides/compatibility.md). Only MobyGames game ids and links, and our own match scores, are kept, as their API terms allow; no title, year or company of theirs. items are confident matches keyed by catalog id; review lists the candidates of ambiguous ones.',
      attribution: 'Game links: MobyGames (https://www.mobygames.com)',
      asked: oldest,
      counts,
      items,
      review,
    })
  );

  for (const [kind, count] of Object.entries(counts)) {
    console.log(
      `${kind}: ${count.confident} confident, ${count.ambiguous} ambiguous, ${count.none} none, ${count.unasked} not asked`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).items;

  if (args.includes('--purge')) {
    rmSync(CACHE, { recursive: true, force: true });
    console.log('MobyGames answers deleted');
    return;
  }

  if (args.includes('--write')) {
    write(catalog);
    return;
  }

  const kind = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const named = args.filter(
    (arg, at) => !arg.startsWith('--') && !['--kind', '--limit'].includes(args[at - 1])
  );
  const cached = new Set(
    existsSync(CACHE) ? readdirSync(CACHE).map((f) => f.replace(/\.json$/, '')) : []
  );

  const todo = (
    named.length
      ? catalog.filter((e) => named.includes(e.id))
      : catalog.filter((e) => !cached.has(e.id))
  )
    .filter((e) => !kind || e.kind === kind)
    .slice(0, limit);

  console.log(
    `${todo.length} entries to ask about, about ${Math.ceil((todo.length * 1.5 * DELAY) / 60_000)} minutes`
  );

  for (const [at, entry] of todo.entries()) {
    await ask(entry);

    if ((at + 1) % 25 === 0) {
      console.log(`${at + 1} of ${todo.length}`);
    }
  }

  write(catalog);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
