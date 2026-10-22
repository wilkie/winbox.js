'use strict';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOX_KEYS } from '../oracle/replay.js';
import {
  PROBES,
  imageFor,
  outputOf,
  recordsFrom,
  runProbe,
  type Base,
} from '../win16/run-probe.js';

/**
 * A probe run whole on the asset bundle's base made on the volume directly
 * (`WINBOX_BASE=assets`) and on that base split into layers and flattened
 * (`WINBOX_BASE=layers`, `split.ts`), each on the virtual clock, for the
 * layered base's sweep (`sweep_test.ts`) and its quick check
 * (`base_test.ts`), as the Rust engine's `tests/layers_sweep.rs`. The
 * oracle's C: is one DOSBox folder, so the layering must never show: each
 * run writes the same records on both, exactly, and ends as it ends. A
 * probe recorded with a sound card (`vgasound`) is not run, as in the asset
 * bundle's sweep.
 */

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

export interface Run {
  fixture: string;
  probe: string;
  display: string;
  ini: string | null;
}

/** Each fixture this engine can run whole on the bundle's base, those `only` names where it names any. */
export function runs(only: string[] = []): Run[] {
  return readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      /* `vgaprint` is the VGA's installation with a printer, which the run
       * puts in itself (`run-probe.ts`). */
      const display = fixture.display === 'vgaprint' ? 'vga' : (fixture.display ?? 'vga');

      return {
        fixture: file.replace(/\.json$/, ''),
        probe: fixture.probe as string,
        display,
        ini: (fixture.source?.ini as string | undefined) ?? null,
      };
    })
    .filter(({ fixture }) => !only.length || only.includes(fixture))
    .filter(({ display }) => display !== 'vgasound' && existsSync(imageFor(display)))
    .filter(({ probe }) => existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`)));
}

/** A probe's run on a base: how it ended, and what it wrote. */
export async function run({ probe, display, ini }: Run, base: Base) {
  const { fileSystem, failure } = await runProbe(probe, 4000, false, true, 30, {
    boxKeys: BOX_KEYS[probe] ?? [],
    display,
    iniPreset: ini,
    virtual: true,
    keepCalls: 0,
    base,
  });

  return {
    stop: failure ? `failed: ${failure?.message ?? failure}` : 'ran',
    records: recordsFrom((await outputOf(fileSystem, probe)) ?? ''),
  };
}

/**
 * Where a probe's run on the layers differs from its run on the folder: none
 * where they are the same -- and, `written`, where both wrote something.
 */
export async function difference(each: Run, written = false) {
  const assets = await run(each, 'assets');
  const layers = await run(each, 'layers');

  if (assets.stop !== layers.stop) {
    return `${each.fixture}: ${assets.stop} on the folder, ${layers.stop} on the layers`;
  }

  if (written && !assets.records.length) {
    return `${each.fixture}: no records on the folder`;
  }

  const length = Math.max(assets.records.length, layers.records.length);

  for (let at = 0; at < length; at++) {
    if (assets.records[at] !== layers.records[at]) {
      return `${each.fixture}: record ${at}, ${JSON.stringify(assets.records[at])} on the folder, ${JSON.stringify(layers.records[at])} on the layers`;
    }
  }

  return null;
}
