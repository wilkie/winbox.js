'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * `DDEML` is WinBox's own (`src/win16/ddeml/`): its probes, run whole, write
 * what Windows wrote with `DDEML.DLL` on the drive -- each import of its
 * linked to WinBox's stub -- and with no `DDEML.DLL` on the drive at all. As
 * `crates/winbox-win16/tests/ddeml.rs`.
 *
 * Each probe's records of the functions it does not yet agree on are left
 * out, as `test/oracle/replay.ts`'s `KNOWN_GAPS` leaves them.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE_GAPS: Record<string, string[]> = {
  ddexact: [],
  ddemgmt: [],
  pmatom: [],
  ddeleft: ['owned', 'DdeFreeStringHandle'],
  progdde: ['files'],
  ddeinst: [],
};
/** As `replay.ts`'s `VIRTUAL_CLOCK`: these run on the instructions' clock. */
const VIRTUAL = new Set(['ddexact', 'progdde']);
const FILES = [['WINDOWS', 'SYSTEM', 'DDEML.DLL']];

/** What the oracle recorded, as `function(args) = result` lines, but the gaps. */
function recorded(probe: string) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8'));

  return fixture.records
    .filter((record: any) => !PROBE_GAPS[probe].includes(record.function))
    .map((record: any) => `${record.function}(${record.args}) = ${record.result}`);
}

const ready = (probe: string) =>
  existsSync(IMAGE) &&
  existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`)) &&
  existsSync(join(FIXTURES, `${probe}.json`));

describe('DDEML, WinBox own', () => {
  for (const probe of Object.keys(PROBE_GAPS)) {
    for (const without of [false, true]) {
      const test = ready(probe) ? it : it.skip;

      test(`${probe} agrees ${without ? 'with no DDEML.DLL' : 'with the file'}`, async () => {
        const { fileSystem, win16 } = await runProbe(probe, 4000, false, true, 30, {
          without: without ? FILES : [],
          virtual: VIRTUAL.has(probe),
        });
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '').filter(
          (line: string) => !PROBE_GAPS[probe].some((name) => line.startsWith(`${name}(`))
        );

        if (without) {
          /* No file: WinBox's alone, no library of DDEML's loaded from a file. */
          expect(win16._modules.fromName('DDEML')?.constructor?.name).not.toBe('Loader');
        }

        expect(written).toEqual(recorded(probe));

        if (probe === 'ddeinst') {
          /* An installer's session: Program Manager, started by it, made the
           * group it was told of through WinBox's DDEML -- its
           * file with the two items, its line in PROGMAN.INI. As
           * `crates/winbox-web/tests/program_manager_dde.rs`. */
          const read = async (parts: string[]) => {
            const opened = await fileSystem.open(parts);

            return opened
              ? Buffer.from(await opened.read(0, opened.info.size)).toString('latin1')
              : '';
          };
          const group = await read(['WINDOWS', 'WINBOXGA.GRP']);

          expect(group).toContain('Solitaire');
          expect(group).toContain('Minesweeper');
          expect(await read(['WINDOWS', 'PROGMAN.INI'])).toContain('WINBOXGA.GRP');
        }
      }, 300000);
    }
  }
});
