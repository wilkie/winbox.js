'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * `VER` and `LZEXPAND` are WinBox's own (`src/win16/ver/`,
 * `src/win16/lzexpand/`): their probes, run whole, write what Windows wrote
 * with the files on the drive -- each import of theirs linked to WinBox's
 * stub -- and with no `VER.DLL` or `LZEXPAND.DLL` on the drive at all.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE_NAMES = ['lzfiles', 'verinfo', 'verinst'];
const FILES = [
  ['WINDOWS', 'SYSTEM', 'VER.DLL'],
  ['WINDOWS', 'SYSTEM', 'LZEXPAND.DLL'],
];

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

describe('VER and LZEXPAND, WinBox own', () => {
  for (const probe of PROBE_NAMES) {
    for (const without of [false, true]) {
      const test = ready(probe) ? it : it.skip;

      test(`${probe} agrees ${without ? 'with no VER.DLL or LZEXPAND.DLL' : 'with the files'}`, async () => {
        const { fileSystem, win16, functions } = await runProbe(probe, 4000, false, true, 60, {
          without: without ? FILES : [],
        });
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '');

        if (without) {
          /* No file: WinBox's alone, no library of either loaded from a file. */
          expect(win16._modules.fromName('VER')?.constructor?.name).not.toBe('Loader');
        }

        /* The probe's calls reach WinBox's code, file or no file: VER's
         * own calls into LZEXPAND are WinBox's, and are not calls through
         * LZEXPAND's stubs, as `VER.DLL`'s code would make them. */
        if (probe !== 'lzfiles') {
          expect(
            functions.has('VER.GetFileVersionInfoSize') || functions.has('VER.VerInstallFile')
          ).toBe(true);
          expect(functions.has('LZEXPAND.LZOpenFile')).toBe(false);
        }

        expect(written).toEqual(recorded(probe));
      }, 300000);
    }
  }
});
