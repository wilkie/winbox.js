'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';
import { Loader } from '../../src/win16/loader.js';

/**
 * `OLECLI` is WinBox's own (`src/win16/olecli/`): its probes, run whole,
 * write what Windows wrote with `OLECLI.DLL` on the drive -- each import of
 * its linked to WinBox's stub -- and with no `OLECLI.DLL` on the drive at
 * all. As `crates/winbox-win16/tests/olecli.rs`.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE_NAMES = ['olestat', 'olemem', 'oledde', 'olepbd', 'olepbr'];
const FILES = [['WINDOWS', 'SYSTEM', 'OLECLI.DLL']];

/** What the oracle recorded, as `function(args) = result` lines. */
function recorded(probe: string) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8'));

  return fixture.records.map(
    (record: any) => `${record.function}(${record.args}) = ${record.result}`
  );
}

const ready = (probe: string) =>
  existsSync(IMAGE) &&
  existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`)) &&
  existsSync(join(FIXTURES, `${probe}.json`));

describe('OLECLI, WinBox own', () => {
  for (const probe of PROBE_NAMES) {
    for (const without of [false, true]) {
      const test = ready(probe) ? it : it.skip;

      test(`${probe} agrees ${without ? 'with no OLECLI.DLL' : 'with the file'}`, async () => {
        const { fileSystem, win16 } = await runProbe(probe, 4000, false, true, 30, {
          without: without ? FILES : [],
        });
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '');

        /* With the file, its library loaded beside WinBox's; with none, no
         * library of OLECLI's loaded from a file. */
        expect(win16._modules.fromName('OLECLI') instanceof Loader).toBe(!without);
        expect(written).toEqual(recorded(probe));
      }, 300000);
    }
  }
});
