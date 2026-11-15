/**
 * Matching the catalog's entries to another list of games by title, year
 * and publisher: Wikipedia's "List of Windows 3.x games" (`wikipedia.mjs`)
 * and MobyGames (`mobygames.mjs`) both go through it, so one set of rules,
 * tested on the free list, decides both. The design is
 * `kb/guides/compatibility.md` ("Matching").
 *
 * A candidate is `{ title, year, companies }`; an entry is the catalog's.
 * Every title an entry has (its chosen title, and each candidate in
 * `titles`) is compared with the candidate's, the best kept. The verdict is
 * `confident`, `ambiguous` or `none`, with the score and why.
 */

import { rejected, stripPrefix } from './titles.mjs';

/** Roman numerals a sequel's title is written with, as numbers. */
const ROMAN = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

/** Words that say nothing of which company: dropped before companies are compared. */
const COMPANY_NOISE = new Set(
  (
    'inc incorporated ltd limited llc co corp corporation company software softworks games ' +
    'entertainment interactive multimedia media publishing studios studio productions ' +
    'group gmbh sa ag plc pty the and of international systems technologies technology computer ' +
    'computers labs development developers'
  ).split(' ')
);

/** A title's words, compared without case, accents, punctuation or the platform. */
export function normalise(title) {
  let text = String(title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  text = text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // "(v1.2)", "[Playable Via Browser]"
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/\b(?:for )?(?:microsoft )?windows(?: 3(?:\.[0-9x]+)?)?\b/g, ' ')
    .replace(/\bwin(?:3\.?[01x]?)?\b/g, ' ')
    .replace(/\b(?:v|ver\.?|version|release)\s*\d+(?:\.\d+)*[a-z]?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/ (?:the )?game$/, '');

  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => ROMAN[word] ?? word)
    .join(' ');
}

/** A title's main part: what precedes a colon or a spaced dash. */
const mainPart = (title) => String(title ?? '').split(/:| - | – /)[0];

/** Dice's coefficient over two lists of words. */
function dice(a, b) {
  if (!a.length || !b.length) {
    return 0;
  }

  const rest = [...b];
  let shared = 0;

  for (const word of a) {
    const at = rest.indexOf(word);

    if (at >= 0) {
      shared++;
      rest.splice(at, 1);
    }
  }

  return (2 * shared) / (a.length + b.length);
}

/**
 * How alike two titles are, 0 to 1: 1 the same once normalised; 0.95 the
 * same without spaces ("SkiFree", "Ski Free"); 0.9 the same main part, one
 * of them having a subtitle; otherwise Dice's coefficient over their words.
 */
export function titleScore(a, b) {
  const x = normalise(a);
  const y = normalise(b);

  if (!x || !y) {
    return 0;
  }

  if (x === y) {
    return 1;
  }

  if (x.replace(/ /g, '') === y.replace(/ /g, '')) {
    return 0.95;
  }

  const mx = normalise(mainPart(a));
  const my = normalise(mainPart(b));

  if ((mx === y || my === x || (mx === my && mx.includes(' '))) && mx && my) {
    return 0.9;
  }

  return dice(x.split(' '), y.split(' '));
}

/** A company's words that name it. */
function companyWords(name) {
  return normalise(name)
    .split(' ')
    .filter((word) => word.length > 1 && !COMPANY_NOISE.has(word));
}

/**
 * Whether two lists of companies share one: a word of one's name that is
 * in the other's ("Sierra On-Line" and "Sierra"), or begins one of four
 * letters or more ("Saada" and "SaadaSoft").
 */
export function companiesAgree(ours, theirs) {
  const words = new Set(ours.flatMap(companyWords));

  const meets = (word) =>
    words.has(word) ||
    (word.length >= 4 &&
      [...words].some(
        (ours) => ours.length >= 4 && (ours.startsWith(word) || word.startsWith(ours))
      ));

  return theirs.some((name) => companyWords(name).some((word) => word.length > 2 && meets(word)));
}

/** An entry's publisher, as a list: archive.org joins several with "; ". */
export const companiesOf = (entry) =>
  String(entry.publisher ?? '')
    .split(/;|\//)
    .map((name) => name.trim())
    .filter(Boolean);

/** Every title an entry is known by, archive.org's with its prefix stripped. */
export function titlesOf(entry) {
  const all = [entry.title, ...Object.values(entry.titles ?? {}).map((t) => stripPrefix(t))];

  /* A file name in capitals is kept ("BATTLES" may be the game's name); a path, an extension or a generic word is not. */
  const useless = new Set(['empty', 'no letters', 'generic', 'not a name', 'a path', 'file name']);

  return [...new Set(all.filter((t) => t && !useless.has(rejected(t, [], 'archiveOrg'))))];
}

/** Whether the title the entry goes by is still a file name: no title to match on. */
export const titledByFileName = (entry) =>
  Boolean(rejected(entry.title, [entry.run?.replace(/\.[^.]*$/, ''), entry.id], 'archiveOrg'));

/**
 * One candidate against one entry: the best title score over the entry's
 * titles, whether the years agree (within one, as a release and its
 * re-release or a list's date and archive.org's), and whether the
 * companies do. The score is the title's, raised a little for each that
 * agrees and lowered for a year more than two apart.
 */
export function scoreOf(entry, candidate) {
  const titles = titlesOf(entry);
  let title = 0;
  let matched = null;

  for (const ours of titles) {
    const score = titleScore(ours, candidate.title);

    if (score > title) {
      title = score;
      matched = ours;
    }
  }

  const years = entry.year && candidate.year ? Math.abs(entry.year - candidate.year) : null;
  const year = years === null ? null : years <= 1;
  const company =
    companiesOf(entry).length && candidate.companies?.length
      ? companiesAgree(companiesOf(entry), candidate.companies)
      : null;

  let score = title;

  if (year === true) {
    score += 0.05;
  } else if (years !== null && years > 2) {
    score -= 0.15;
  }

  if (company === true) {
    score += 0.1;
  }

  return { score: Math.round(score * 1000) / 1000, title, matched, year, years, company };
}

/**
 * The verdict for an entry over every candidate:
 *
 * - `confident`: the best title scores 0.9 or more, nothing contradicts it
 *   (the years are not more than two apart), the year or the company
 *   agrees -- or the title is the same exactly and neither is known -- and
 *   no other candidate is as good (within 0.1, unless the best is the only
 *   one whose year and company agree);
 * - `ambiguous`: the best title scores 0.75 or more but is not confident;
 * - `none`: nothing scores 0.75.
 *
 * An entry still titled by a file name ("BATTLES") is confident only where
 * both the year and the company agree. A title of one word ("Hearts",
 * "Golf", "Simon") is shared by many shareware games: it is confident only
 * where the company agrees, or the year does and no company is known on
 * one side; a year alone, against companies that differ, is not enough.
 */
export function verdictOf(entry, candidates) {
  const scored = candidates
    .map((candidate) => ({ candidate, ...scoreOf(entry, candidate) }))
    .filter((row) => row.title >= 0.5)
    .sort((a, b) => b.score - a.score)
    /* A game's other titles are candidates of their own; it counts once, at its best. */
    .filter(
      (row, at, all) =>
        row.candidate.id === undefined ||
        all.findIndex((r) => r.candidate.id === row.candidate.id) === at
    );

  const [best, next] = scored;

  if (!best || best.title < 0.75) {
    return { verdict: 'none', best: best ?? null, others: [] };
  }

  const others = scored.slice(1, 5);
  const contradicted = best.years !== null && best.years > 2;
  const fileName = titledByFileName(entry);
  const oneWord = !normalise(best.matched).includes(' ');
  const supported = fileName
    ? best.year === true && best.company === true
    : oneWord
      ? best.company === true || (best.year === true && best.company === null)
      : best.year === true ||
        best.company === true ||
        (best.title === 1 && best.year === null && best.company === null);
  const clear =
    !next ||
    next.score < best.score - 0.1 ||
    (best.year === true && best.company === true && !(next.year === true && next.company === true));

  const confident = best.title >= 0.9 && !contradicted && supported && clear;

  return { verdict: confident ? 'confident' : 'ambiguous', best, others };
}

/**
 * A file of matches as the catalog is written, a line an entry: each
 * top-level field on a line of its own, and `items` and `review` an entry a
 * line, keyed by catalog id, so a change to one entry is one line's diff.
 */
export function linesOf(object) {
  const field = ([name, value]) => {
    if ((name === 'items' || name === 'review') && value && typeof value === 'object') {
      const rows = Object.entries(value).map(
        ([id, row]) => `${JSON.stringify(id)}: ${JSON.stringify(row)}`
      );
      return `${JSON.stringify(name)}: {${rows.length ? `\n${rows.join(',\n')}\n` : ''}}`;
    }

    return `${JSON.stringify(name)}: ${JSON.stringify(value)}`;
  };

  return `{\n${Object.entries(object).map(field).join(',\n')}\n}\n`;
}
