'use strict';

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STAMP } from '../../src/assets/compose.js';
import { installedLayer } from '../../src/layers/install.js';
import { baseName } from '../../src/layers/layer.js';
import { Fat16Changes } from '../../src/run/changes.js';
import { type Plan } from '../../src/run/drive.js';
import { bundle, runProbe } from '../win16/run-probe.js';

/**
 * A program of the corpus installed by its own installer into a layer
 * (`kb/formats/layer.md`, "An installer into a layer"): Caribbean
 * Treasure's SETUP.EXE, its media -- the archive's three files -- placed at
 * `C:\CARIBB` on the asset bundle's base for the VGA under an empty top, on
 * the virtual clock. Its steps are a person's: "Install Caribbean
 * Treasure", OK to `c:\windows\games`, Yes to make it, and Enter on the
 * last page. Its top's changes are made a layer over the base, the media
 * dropped, and held to `test/layers/caribb-layer.json` -- which the Rust
 * engine's run of the same installer, its clicks and keys where this run
 * made them (`stepMarks`), is held to as well
 * (`crates/winbox-win16/tests/install_caribb.rs`). There is no Program
 * Manager on the base: the installer's three `DdeConnect`s to `PROGMAN`
 * fail, and it goes on without a group.
 *
 * Skipped without the corpus's program or the bundle; `CARIBB_LAYER_WRITE=1`
 * writes the fixture from this run.
 */

const ROOT = join(__dirname, '..', '..');
const MEDIA = join(ROOT, 'corpus', 'programs', 'caribb');
const FIXTURE = join(__dirname, 'caribb-layer.json');
const ready = existsSync(join(MEDIA, 'SETUP.EXE')) && bundle() !== null;

/** The steps, as a person took them: where each click went, and how long after. */
const STEPS = [
  { keys: ['click:320,272'], seconds: 5 },
  { keys: ['click:463,210'], seconds: 5 },
  { keys: ['click:285,303'], seconds: 150 },
  { keys: ['Return'], seconds: 10 },
];

(ready ? describe : describe.skip)("Caribbean Treasure's installer into a layer", () => {
  it('installs into a layer the Rust engine makes too', async () => {
    let changes: Fat16Changes | null = null;
    const run = await runProbe('caribb', 3000, false, true, 10, {
      boxKeys: [['Enter'], ['Enter'], ['Enter']],
      virtual: true,
      keepCalls: 0,
      base: 'assets',
      display: 'vga',
      own: false,
      brought: false,
      start: 'C:\\CARIBB\\SETUP.EXE',
      directory: 'C:\\CARIBB',
      markPointers: true,
      shell: false,
      steps: STEPS,
      prepare: async (fileSystem) => {
        for (const name of readdirSync(MEDIA).sort()) {
          const data = new Uint8Array(readFileSync(join(MEDIA, name)));

          await fileSystem.map(
            ['CARIBB', name.toUpperCase()],
            new DataView(data.buffer, data.byteOffset, data.byteLength),
            { modified: STAMP, archive: true }
          );
        }

        changes = new Fat16Changes(fileSystem, { placements: [] } as unknown as Plan);
        await changes.mark();
      },
    });

    expect(run.failure ?? null).toBeNull();

    const installed = await installedLayer(await changes!.changes(), {
      media: ['CARIBB'],
      over: [baseName(bundle()!.id, 'vga')],
      made: { by: 'WinBox', from: 'CARIBB.ZIP' },
    });
    const made = {
      stepMarks: run.stepMarks,
      layer: installed.layer.manifest,
      dropped: installed.dropped,
      references: installed.references,
    };

    if (process.env.CARIBB_LAYER_WRITE === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(made, null, 1)}\n`);
    }

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    /* The installer ended, its task gone, once Enter was pressed. */
    const tasks = Object.values(run.win16.scheduler._tasks ?? {}) as any[];

    expect(tasks.length > 0 && tasks.every((task) => task.ended)).toBe(true);
    expect(made.layer).toEqual(fixture.layer);
    expect(made.dropped).toEqual(fixture.dropped);
    expect(made.references).toEqual(fixture.references);
  }, 900_000);
});
