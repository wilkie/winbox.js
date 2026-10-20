'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Assets } from '../../src/assets/bundle.js';
import { logo } from '../../src/win16/shell/about.js';
import { PROBES, bundle, outputOf, recordsFrom, runProbe, type Base } from '../win16/run-probe.js';

/**
 * The engine started from the asset bundle alone: drive C: is the base the
 * bundle composes for the display, and the kept modules' files -- USER's,
 * SHELL's, the display driver's -- come from its store (`options.assets`).
 * The probes that read what the bundle keeps -- the display driver's
 * resources (`drvres`), USER's drawing of a window's frame (`chrome`), the
 * fonts GDI loads from the profiles (`fontboot`) and SHELL's About box
 * (`about`) -- write the same records on it as on the oracle's
 * installation. As the Rust engine's `tests/asset_base.rs`.
 *
 * The bundle is made by `pnpm assets` into `oracle/build/assets`; skipped
 * without it, or the probes.
 */

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/** Each fixture: its probe, the display it was recorded on, and its `WIN.INI` preset. */
const RUNS: { fixture: string; probe: string; display: string; ini: string | null }[] = [
  ...['vga', 'ega', 'hercules', 'svga'].flatMap((display) =>
    ['drvres', 'chrome'].map((probe) => ({
      fixture: `${probe}-${display}`,
      probe,
      display,
      ini: null,
    }))
  ),
  ...['fonts', 'ttoff', 'ttonly'].map((ini) => ({
    fixture: `fontboot-${ini}`,
    probe: 'fontboot',
    display: 'vga',
    ini,
  })),
  { fixture: 'about', probe: 'about', display: 'vga', ini: null },
];

const built = (probe: string) => existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`));
const ready = bundle() !== null && RUNS.some(({ probe }) => built(probe));

/** A probe's run on a base: its records, and the system it ran on. */
async function run({ probe, display, ini }: (typeof RUNS)[number], base: Base) {
  const { fileSystem, win16 } = await runProbe(probe, 4000, false, true, 30, {
    display,
    iniPreset: ini,
    base,
  });

  return { records: recordsFrom((await outputOf(fileSystem, probe)) ?? ''), win16 };
}

(ready ? describe : describe.skip)('the asset bundle base', () => {
  for (const each of RUNS) {
    (built(each.probe) ? it : it.skip)(
      `${each.fixture} writes on it what it writes on the installation`,
      async () => {
        const installed = await run(each, 'installed');
        const assets = await run(each, 'assets');

        expect(assets.records).toEqual(installed.records);
        expect(assets.records.length).toBeGreaterThan(0);

        /* The About box's logo, which no record holds: from the bundle's
         * SHELL.DLL as from the installation's. */
        if (each.probe === 'drvres') {
          const theirs: any = await logo(installed.win16);
          const ours: any = await logo(assets.win16);

          expect(theirs).not.toBeNull();
          expect(Array.from(ours.indices)).toEqual(Array.from(theirs.indices));
        }

        /* And Windows' own records, where the fixture has them all. */
        const fixture = JSON.parse(readFileSync(join(FIXTURES, `${each.fixture}.json`), 'utf8'));

        expect(assets.records.length).toBe(fixture.records.length);
      },
      300_000
    );
  }

  it('reads the zip as the folder', async () => {
    const zip = await Assets.fromZip(
      new Uint8Array(readFileSync(join(ROOT, 'oracle', 'build', 'winbox-assets.zip')))
    );
    const folder = bundle()!;

    expect(zip.id).toBe(folder.id);
    expect([...zip.modules.keys()]).toEqual([...folder.modules.keys()]);
    expect([...zip.pool.keys()]).toEqual([...folder.pool.keys()]);
    expect(zip.module('vga.drv')).toEqual(folder.module('VGA.DRV'));
  });
});
