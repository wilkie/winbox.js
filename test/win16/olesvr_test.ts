'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';
import { Loader } from '../../src/win16/loader.js';

/**
 * `OLESVR` is WinBox's own (`src/win16/olesvr/`): its probes, run whole,
 * write what Windows wrote with `OLESVR.DLL` on the drive -- each import of
 * its linked to WinBox's stub -- and with no `OLESVR.DLL` on the drive at
 * all: the conversations (`olesrv`), Paintbrush's (`olepbr`), and the
 * windows and properties its clients are kept on (`oleitem`). As
 * `crates/winbox-win16/tests/olesvr.rs`.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE_NAMES = ['olesrv', 'olepbr', 'oleitem'];

/* `oleitem`'s one known gap (`replay.ts`'s `KNOWN_GAPS`): Windows' EnumProps
 * still lists the property DELETECLIENTINFO took from Item3's window. */
const GAP = /^props\(Item3\) = /;
const unlessGap = (lines: string[]) => lines.filter((line) => !GAP.test(line));
const FILES = [['WINDOWS', 'SYSTEM', 'OLESVR.DLL']];

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

describe('OLESVR, WinBox own', () => {
  for (const probe of PROBE_NAMES) {
    for (const without of [false, true]) {
      const test = ready(probe) ? it : it.skip;

      test(`${probe} agrees ${without ? 'with no OLESVR.DLL' : 'with the file'}`, async () => {
        const { fileSystem, win16 } = await runProbe(probe, 4000, false, true, 120, {
          without: without ? FILES : [],
        });
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '');

        /* With none, no library of OLESVR's loaded from a file. With the
         * file, its library is let go as its server ends. */
        if (without) {
          expect(win16._modules.fromName('OLESVR') instanceof Loader).toBe(false);
        }
        expect(unlessGap(written)).toEqual(unlessGap(recorded(probe)));
      }, 300000);
    }
  }

  /* Paintbrush serving its picture to a client with neither library's file
   * on the drive: WinBox's `OLESVR` to WinBox's `OLECLI`. */
  (ready('olepbr') ? it : it.skip)(
    'olepbr agrees with neither DLL',
    async () => {
      const { fileSystem, win16 } = await runProbe('olepbr', 4000, false, true, 120, {
        without: [...FILES, ['WINDOWS', 'SYSTEM', 'OLECLI.DLL']],
      });
      const written = recordsFrom((await outputOf(fileSystem, 'olepbr')) ?? '');

      expect(win16._modules.fromName('OLECLI') instanceof Loader).toBe(false);
      expect(written).toEqual(recorded('olepbr'));
    },
    300000
  );
});
