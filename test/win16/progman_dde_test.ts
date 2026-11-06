'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';
import { Block, argument, white } from '../../src/win16/progman/parse.js';

/**
 * WinBox's own Program Manager (`src/win16/progman/`): the probes that talk to
 * Program Manager, run with `PROGMAN.EXE` taken off the installation so that
 * WinBox's answers, held to what Windows wrote with Microsoft's -- its DDE,
 * what its commands change, its group files and `PROGMAN.INI`. As
 * `crates/winbox-win16/tests/progman_dde.rs`.
 *
 * WinBox's frame is hidden, by the owner's decision, and so every group's
 * window with it: a `windows` record's visibility is left out (`hidden`); its
 * places, icons and zooms are held. Any record left out is named, with why,
 * in `progman-dde-gaps.json`, which both engines' tests read; the rest are
 * held, in order.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const GAPS: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(join(__dirname, 'progman-dde-gaps.json'), 'utf8')
);
const PROBE_NAMES = [
  'progdde',
  'pmraw',
  'pmatom',
  'ddeinst',
  'pmsyntax',
  'pmbare-vga',
  'pmbare-ega',
  'pmfiles',
  'pmgroups',
  'pmitem',
];
/** As `replay.ts`'s `VIRTUAL_CLOCK`: these run on the instructions' clock. */
const VIRTUAL = new Set(['progdde', 'pmraw', 'pmsyntax', 'pmbare', 'pmfiles', 'pmgroups']);

/** A fixture's probe and the display it was recorded on: `pmbare-ega` is `pmbare` on the EGA. */
function probeOf(fixture: string): [string, string] {
  const [probe, display] = fixture.split('-');

  return [probe, display ?? 'vga'];
}

/**
 * A `windows` record with each window's visibility, its first digit of three,
 * made `-`: WinBox's frame is hidden, and its groups' windows in it.
 */
function hidden(line: string) {
  if (!line.startsWith('windows(')) {
    return line;
  }

  const at = line.indexOf(') = ') + 4;

  return (
    line.slice(0, at) +
    line
      .slice(at)
      .split(';')
      .map((part) => part.replace(/:(\d)(\d\d)$/, ':-$2'))
      .join(';')
  );
}

/**
 * The records not left out: a function's name leaves out all of its records,
 * `function(args)` those with those arguments, and `function(args)#n` the nth
 * of them.
 */
function held(lines: string[], gaps: string[]) {
  const seen = new Map<string, number>();

  return lines
    .filter((line) => {
      const name = line.slice(0, line.indexOf('('));
      const call = line.slice(0, line.indexOf(') = ') + 1);
      const count = (seen.get(call) ?? 0) + 1;

      seen.set(call, count);

      return !gaps.some((gap) => gap === name || gap === call || gap === `${call}#${count}`);
    })
    .map(hidden);
}

/** What the oracle recorded, as `function(args) = result` lines. */
function recorded(probe: string): string[] {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8'));

  return fixture.records.map(
    (record: any) => `${record.function}(${record.args}) = ${record.result}`
  );
}

const ready = (fixture: string) =>
  existsSync(IMAGE) &&
  existsSync(join(PROBES, `${probeOf(fixture)[0].toUpperCase()}.EXE`)) &&
  existsSync(join(FIXTURES, `${fixture}.json`));

const bytes = (value: string) => [...Array.from(value, (c) => c.charCodeAt(0)), 0];
const at = (block: Block, offset: number) => String.fromCharCode(...block.string(offset));

describe("WinBox's Program Manager's DDE", () => {
  it('reads arguments as PROGMAN.EXE does', () => {
    expect(white(0x20)).toBe(true);
    expect(white(0xe9)).toBe(true);
    expect(white(0x21)).toBe(false);

    const spaced = new Block(bytes('Spaced name  )]'));

    expect(argument(spaced, 0)).toEqual([0, 13]);
    expect(at(spaced, 0)).toBe('Spaced name');

    const cafe = new Block(bytes('Caf\xe9)'));

    argument(cafe, 0);
    expect(at(cafe, 0)).toBe('Caf');

    const quoted = new Block(bytes('"Ca""lc")'));
    const [first, next] = argument(quoted, 0)!;
    const [second] = argument(quoted, next)!;

    expect([at(quoted, first), at(quoted, second)]).toEqual(['Ca', 'lc']);
    expect(argument(new Block(bytes('"Unclosed)]')), 0)).toBeNull();
    expect(argument(new Block(bytes('Bracket[)]')), 0)).toBeNull();
    expect(argument(new Block(bytes(',,)')), 0)).toEqual([0, 1]);
  });

  for (const fixture of PROBE_NAMES) {
    const [probe, display] = probeOf(fixture);

    (ready(fixture) ? it : it.skip)(
      `${fixture} agrees with no PROGMAN.EXE`,
      async () => {
        const { fileSystem, win16 } = await runProbe(probe, 4000, false, true, 30, {
          without: [['WINDOWS', 'PROGMAN.EXE']],
          virtual: VIRTUAL.has(probe),
          display,
          bundleStore: true,
        });
        const gaps = Object.keys(GAPS[fixture] ?? {});
        const written = recordsFrom((await outputOf(fileSystem, probe)) ?? '');

        /* WinBox's, started where the file is not. */
        expect(!!win16._progmanKept).toBe(true);
        expect(held(written, gaps)).toEqual(held(recorded(fixture), gaps));
      },
      300000
    );
  }
});
