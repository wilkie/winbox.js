'use strict';

import { bundle } from '../assets/built.js';
import { difference, runs } from './runs.js';

/**
 * The layered base (`WINBOX_BASE=layers`, `split.ts`) on every run: a
 * handful of probes that list folders, open, search and write files and
 * read and write the profiles write on it exactly what they write on the
 * base made directly. The whole sweep is `sweep_test.ts`; that the stack
 * flattens to the base is `layered_base_test.ts`. Skipped without the
 * bundle (`pnpm assets`) or the probes.
 */

const ready = bundle() !== null;

(ready ? describe : describe.skip)('the layered base', () => {
  for (const each of runs([
    'dirorder',
    'diskfree',
    'filecdr',
    'loadpath',
    'openfile',
    'profile',
    'profnew',
  ])) {
    it(`${each.fixture} writes on it what it writes on the base made directly`, async () => {
      expect(await difference(each, true)).toBeNull();
    }, 300_000);
  }
});
