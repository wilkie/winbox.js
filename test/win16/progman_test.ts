'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { image } from '../../src/win16/progman/image.js';
import {
  holdsProgman,
  menuTemplate,
  readNumber,
  windowNumbers,
} from '../../src/win16/progman/main.js';
import { IMAGE, PROBES, bundle, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * WinBox's own Program Manager (`src/win16/progman/`), started where a
 * program starts `PROGMAN.EXE` and there is none: `pmstart`, run with the
 * file taken off the installation and on the asset bundle's base, which has
 * none, is held to what Windows wrote with Microsoft's; and run with the file,
 * Microsoft's runs. As `crates/winbox-win16/tests/progman.rs`.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE = 'pmstart';

/**
 * What it is not held to with Microsoft's: `GetModuleHandle` of a program's
 * name, which WinBox answers nought for a program loaded from its file
 * (`kb/kernel/getmodulehandle.md`).
 */
const WITH_FILE = ['module'];
/**
 * And with WinBox's: its frame is hidden, by the owner's decision; and it does
 * not yet save its settings as it closes.
 */
const WITHOUT_FILE = ['visible', 'saved'];

/** The image's digest and size, and the menu template's size, as the Rust engine's tests have them. */
const IMAGE_SHA256 = '89a699814c6d1b516817239577f2e6df0ed59ea978ba4fc7f6acf456d1aa4d16';
const IMAGE_SIZE = 2504;
const MENU_SIZE = 439;

/** What the oracle recorded, as `function(args) = result` lines, but the gaps. */
function recorded(gaps: string[]) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${PROBE}.json`), 'utf8'));

  return fixture.records
    .filter((record: any) => !gaps.includes(record.function))
    .map((record: any) => `${record.function}(${record.args}) = ${record.result}`);
}

const ready = () =>
  existsSync(IMAGE) &&
  existsSync(join(PROBES, `${PROBE.toUpperCase()}.EXE`)) &&
  existsSync(join(FIXTURES, `${PROBE}.json`));

/** A run of the probe: its records, those but the gaps, and whether WinBox's was started. */
async function run(gaps: string[], options: any) {
  const { fileSystem, win16 } = await runProbe(PROBE, 4000, false, true, 30, options);
  const written = recordsFrom((await outputOf(fileSystem, PROBE)) ?? '');

  return {
    all: written,
    kept: written.filter((line: string) => !gaps.some((name) => line.startsWith(`${name}(`))),
    ours: !!win16._progmanKept,
  };
}

describe("WinBox's Program Manager", () => {
  it('is the image the Rust engine makes', () => {
    const bytes = image();

    expect(bytes.length).toBe(IMAGE_SIZE);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(IMAGE_SHA256);
    expect(menuTemplate().length).toBe(MENU_SIZE);
  });

  it('reads Window= and shell= as PROGMAN.EXE does', () => {
    expect(windowNumbers('4 0 636 408 1')).toEqual([4, 0, 636, 408, 1]);
    expect(windowNumbers('-4,x10 20 30 7junk')).toEqual([0xfffc, 10, 20, 30, 7]);
    expect(windowNumbers('1 2 3 4')).toBeNull();
    expect(readNumber('-12x')).toBe(0xfff4);
    expect(holdsProgman('C:\\WINDOWS\\progman.exe /x')).toBe(true);
    expect(holdsProgman('PMSTART.EXE')).toBe(false);
  });

  const test = ready() ? it : it.skip;

  test("Microsoft's runs with the file", async () => {
    const { kept, ours } = await run(WITH_FILE, {});

    expect(ours).toBe(false);
    expect(kept).toEqual(recorded(WITH_FILE));
  }, 300000);

  test("WinBox's runs with none", async () => {
    const { all, kept, ours } = await run(WITHOUT_FILE, {
      without: [['WINDOWS', 'PROGMAN.EXE']],
    });

    /* Its frame there, hidden, and every other record Windows'. */
    expect(ours).toBe(true);
    expect(all).toContain('visible(frame) = 0');
    expect(kept).toEqual(recorded(WITHOUT_FILE));
  }, 300000);

  (ready() && bundle() ? it : it.skip)(
    "WinBox's runs on the bundle's base",
    async () => {
      /* The base has no PROGMAN.INI or group files to delete. */
      const gaps = [...WITHOUT_FILE, 'delete'];
      const { kept, ours } = await run(gaps, { base: 'assets' });

      expect(ours).toBe(true);
      expect(kept).toEqual(recorded(gaps));
    },
    300000
  );
});
