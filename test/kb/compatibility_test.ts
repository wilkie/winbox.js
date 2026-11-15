'use strict';

import {
  latestRating,
  queueLinksOf,
  type RatingRecord,
  readCompatibility,
  renderTable,
  resultsOf,
  validateRatings,
} from '../../scripts/kb/compatibility.js';
import type { Targets } from '../../scripts/kb/markup.js';

/**
 * The compatibility table's data: the ratings people add as files, held to
 * their format; the first pass's results, read in whatever shape they are
 * written, or not at all while it runs. See `kb/guides/compatibility.md`.
 */
describe('the compatibility table', () => {
  const ids = new Set(['win3_SOLUS', 'win3_WINANT']);
  const today = new Date('2026-11-14T12:00:00Z');
  const good: RatingRecord = {
    rating: 'playable',
    commit: '1172e53a',
    date: '2026-11-14',
    note: 'Played three rounds; the shareware box comes up first, as on Windows.',
  };

  describe('ratings', () => {
    it('take a sound file', () => {
      expect(validateRatings('win3_SOLUS.json', { ratings: [good] }, ids, today)).toEqual([]);
      expect(
        validateRatings(
          'win3_SOLUS.json',
          { ratings: [{ ...good, rater: 'wilkie', display: 'vga256', mode: 'enhanced' }] },
          ids,
          today
        )
      ).toEqual([]);
    });

    it('refuse a program the catalog does not have', () => {
      expect(validateRatings('nothing.json', { ratings: [good] }, ids, today)).toEqual([
        'nothing.json: nothing is not an id in catalog/catalog.json',
      ]);
    });

    it('refuse a rating that is not one of the four', () => {
      expect(
        validateRatings('win3_SOLUS.json', { ratings: [{ ...good, rating: 'great' }] }, ids, today)
      ).toHaveLength(1);
    });

    it('refuse a commit, a date or a note that is not one', () => {
      for (const bad of [
        { commit: 'develop' },
        { commit: '1172E53A' },
        { date: '2026-02-30' },
        { date: '14/11/2026' },
        { date: '2027-01-01' },
        { note: '' },
        { note: undefined },
      ]) {
        expect(
          validateRatings('win3_SOLUS.json', { ratings: [{ ...good, ...bad }] }, ids, today)
        ).toHaveLength(1);
      }
    });

    it('refuse an email address as a rater, and fields of their own', () => {
      expect(
        validateRatings(
          'win3_SOLUS.json',
          { ratings: [{ ...good, rater: 'someone@example.com' }] },
          ids,
          today
        )
      ).toHaveLength(1);
      expect(
        validateRatings(
          'win3_SOLUS.json',
          { ratings: [{ ...good, email: 'someone@example.com' }] },
          ids,
          today
        )
      ).toHaveLength(1);
    });

    it('refuse an empty list or another shape', () => {
      expect(validateRatings('win3_SOLUS.json', { ratings: [] }, ids, today)).toHaveLength(1);
      expect(validateRatings('win3_SOLUS.json', [good], ids, today).length).toBeGreaterThan(0);
    });

    it('show the latest', () => {
      expect(
        latestRating([
          { ...good, date: '2026-12-01', rating: 'fails' },
          { ...good, date: '2026-11-01' },
        ])?.rating
      ).toBe('fails');
      expect(latestRating(undefined)).toBeNull();
    });
  });

  describe("the first pass's results", () => {
    const row = { id: 'win3_SOLUS', status: 'idle', commit: '1172e53a', date: '2026-11-14' };

    it('are read as an object of items, a list, an object by id or a record a line', () => {
      for (const text of [
        JSON.stringify({ items: [row] }),
        JSON.stringify([row]),
        JSON.stringify({ win3_SOLUS: { status: 'idle' } }),
        `${JSON.stringify(row)}\n${JSON.stringify({ ...row, id: 'win3_WINANT' })}\n`,
      ]) {
        expect(resultsOf(text).get('win3_SOLUS')?.status).toBe('idle');
      }
    });

    it('may be empty while the first pass runs', () => {
      expect(resultsOf('').size).toBe(0);
      expect(resultsOf('{"items": []}').size).toBe(0);
    });

    it("take the queue's links to the page that explains a group", () => {
      const links = queueLinksOf({
        groups: [
          { signature: 'USER.Foo', ids: ['win3_SOLUS'], page: 'topic:win386' },
          { signature: 'x', programs: [{ id: 'win3_WINANT' }], probe: 'smearmod' },
          { signature: 'y', ids: ['other'] },
        ],
      });

      expect([...links]).toEqual([
        ['win3_SOLUS', 'topic:win386'],
        ['win3_WINANT', 'probe:smearmod'],
      ]);
    });
  });

  it('builds from the committed catalog, its ratings sound', () => {
    const data = readCompatibility(process.cwd());
    expect(data).not.toBeNull();

    const targets: Targets = {
      functions: new Map(),
      topics: new Map([['win32s', { url: 'topics/win32s/index.html', title: 'Win32s' }]]),
      formats: new Map(),
      guides: new Map(),
      probes: new Map(),
      fonts: new Map(),
    };
    const table = renderTable(data!, { targets, commitUrl: () => null, up: '../' });

    expect(table.total).toBe(data!.entries.length);
    expect(table.rows[0]).toMatch(/^<tr data-title=/);
    expect(table.rows.join('\n')).toContain('https://archive.org/details/');

    /* A runtime the first pass placed is named beside the status. */
    const entry = data!.entries[0];
    const placed = renderTable(
      {
        ...data!,
        entries: [entry],
        results: new Map([
          [entry.id, { id: entry.id, status: 'idle', runtimes: ['KNPG', 'KNPS'] }],
        ]),
      },
      { targets, commitUrl: () => null, up: '../' }
    );

    expect(placed.rows[0]).toContain('<span class="note">with KNPG and KNPS</span>');
  });
});
