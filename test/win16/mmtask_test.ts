'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { image } from '../../src/win16/mmsystem/mmtask.js';
import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * WinBox's own `MMTASK` (`src/win16/mmsystem/mmtask.ts`), started where
 * `mmTaskCreate` starts `MMTASK.TSK` and there is none: `mmtaskc`, run with
 * the file taken off the installation, is held to what Windows wrote with
 * Microsoft's; and run with the file, Microsoft's runs. As
 * `crates/winbox-win16/tests/mmtask.rs`.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const PROBE = 'mmtaskc';

/** The image's digest and size, as the Rust engine's test has them. */
const IMAGE_SHA256 = 'bc45e530211a3418a9f161dda8852690f903c3d2bec1b7da794de944e4e76a50';
const IMAGE_SIZE = 272;

/** What the oracle recorded, as `function(args) = result` lines. */
function recorded() {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${PROBE}.json`), 'utf8'));

  return fixture.records.map((record: any) => `${record.function}(${record.args}) = ${record.result}`);
}

const ready = () =>
  existsSync(IMAGE) &&
  existsSync(join(PROBES, `${PROBE.toUpperCase()}.EXE`)) &&
  existsSync(join(FIXTURES, `${PROBE}.json`));

/** A run of the probe: its records, and whether WinBox's `MMTASK` was started. */
async function run(options: any) {
  const { fileSystem, win16 } = await runProbe(PROBE, 4000, false, true, 30, options);
  const records = recordsFrom((await outputOf(fileSystem, PROBE)) ?? '');
  const ours = !!win16._mmtasksStarted;

  return { records, ours };
}

describe("WinBox's MMTASK", () => {
  it('is the image the Rust engine makes', () => {
    const bytes = image();

    expect([bytes.length, createHash('sha256').update(bytes).digest('hex')]).toEqual([
      IMAGE_SIZE,
      IMAGE_SHA256,
    ]);
  });

  const test = ready() ? it : it.skip;

  test("Microsoft's runs with the file", async () => {
    const { records, ours } = await run({});

    expect(ours).toBe(false);
    expect(records).toEqual(recorded());
  }, 300000);

  test("WinBox's runs with none", async () => {
    const { records, ours } = await run({ without: [['WINDOWS', 'SYSTEM', 'MMTASK.TSK']] });

    expect(ours).toBe(true);
    expect(records).toEqual(recorded());
  }, 300000);
});
