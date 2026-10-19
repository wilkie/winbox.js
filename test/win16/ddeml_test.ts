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
  ddefail: [],
  ddemon: [],
  ddeterm: [],
  ddelist: [],
  ddenest: [],
  ddeheap: [],
  ddehsz: [],
  ddewep: [],
};
/**
 * The records more that do not agree with no `DDEML.DLL` on the drive:
 * none. WinBox's own DDEML, with no file, is counted as its file would be
 * (`library.ts`'s `useOwn`). As `crates/winbox-win16/tests/ddeml.rs`'s
 * `WITHOUT_FILE`.
 */
const WITHOUT_GAPS: Record<string, string[]> = {};
/** As `replay.ts`'s `VIRTUAL_CLOCK`: these run on the instructions' clock. */
const VIRTUAL = new Set(['ddexact', 'progdde', 'ddeterm', 'ddenest']);
/** As `replay.ts`'s `SECONDS`. */
const SECONDS: Record<string, number> = { ddenest: 100 };
const FILES = [['WINDOWS', 'SYSTEM', 'DDEML.DLL']];

/** The functions a probe's run is not held to, with the file or without it. */
const gapsOf = (probe: string, without: boolean) => [
  ...PROBE_GAPS[probe],
  ...(without ? (WITHOUT_GAPS[probe] ?? []) : []),
];

/** What the oracle recorded, as `function(args) = result` lines, but the gaps. */
function recorded(probe: string, gaps: string[]) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8'));

  return fixture.records
    .filter((record: any) => !gaps.includes(record.function))
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
        /* Which of Program Manager's windows were shown as the installer ran,
         * looked at before each call it made: its frame, and the group it was
         * told to make and show. */
        const shown = new Set<string>();
        const watch =
          probe === 'ddeinst'
            ? (_call: any, _count: number, system: any) => {
                for (const window of system.rasterDesktop?.windows ?? []) {
                  if (window.visible) {
                    shown.add(window.title);
                  }
                }
              }
            : null;
        const { fileSystem, win16 } = await runProbe(
          probe,
          4000,
          false,
          true,
          SECONDS[probe] ?? 30,
          {
            without: without ? FILES : [],
            virtual: VIRTUAL.has(probe),
            watch,
          }
        );
        const gaps = gapsOf(probe, without);
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '').filter(
          (line: string) => !gaps.some((name) => line.startsWith(`${name}(`))
        );

        if (without) {
          /* No file: WinBox's alone, no library of DDEML's loaded from a file. */
          expect(win16._modules.fromName('DDEML')?.constructor?.name).not.toBe('Loader');
        }

        expect(written).toEqual(recorded(probe, gaps));

        if (probe === 'ddeinst') {
          /* An installer's session: Program Manager, started by it, made the
           * group it was told of through WinBox's DDEML -- its window shown,
           * its file with the two items, its line in PROGMAN.INI. As
           * `crates/winbox-web/tests/program_manager_dde.rs`, which looks for
           * the same two windows. Read out of `PROGMAN.EXE`: its frame, of
           * class `Progman` and titled "Program Manager", is the window that
           * answers DDE (seg2 `228c`-`2296`, seg7 `1416`); `[CreateGroup]`
           * makes the group's window and makes it the current group (seg7
           * `036f`, seg4 `2662`-`2826`), and `[ShowGroup]` shows it with
           * `ShowWindow` (seg7 `0821`). */
          expect(shown.has('Program Manager')).toBe(true);
          expect(shown.has('WinBox Games')).toBe(true);

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
