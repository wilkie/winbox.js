'use strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installedLayer } from '../../src/layers/install.js';
import { type Change } from '../../src/run/changes.js';

/**
 * An installer run into a layer (`kb/formats/layer.md`, "An installer into
 * a layer"): the layer the page makes of an installer's changes
 * (`installedLayer`, `src/run/page/install.ts`), the media discarded.
 *
 * The changes are those `instlay`'s installer made on the Rust engine, on
 * the installed VGA base, its media -- itself and the program beside it in
 * `C:\WINDOWS`, where the recorder puts them, and `C:\ORACLE` -- placed on
 * C: under an empty top: `crates/winbox-win16/tests/install_layer.rs`
 * holds that run to the oracle's recording, record for record, and the
 * program it installed run alone on the base and the layer to what it read
 * back on Windows, and writes the changes and the layer it made of them
 * (`Layer::installed`) to `instlay-layer.json` (`INSTLAY_WRITE=1`). Here the
 * page's own `installedLayer` makes the same layer of them.
 */

const fixture = JSON.parse(readFileSync(join(__dirname, 'instlay-layer.json'), 'utf8'));

const changes: Change[] = fixture.changes.map((change: any) =>
  change.kind === 'file'
    ? { ...change, data: new Uint8Array(Buffer.from(change.data, 'hex')) }
    : change
);

describe('an installer run into a layer', () => {
  it("makes the layer the Rust engine made of the installer's changes", async () => {
    const installed = await installedLayer(changes, {
      media: fixture.media,
      over: ['install:vga'],
      made: { by: 'WinBox probe harness', from: 'instlay' },
    });

    expect(installed.layer.manifest).toEqual(fixture.manifest);
    expect(installed.dropped).toEqual(fixture.dropped);
    expect(installed.references).toEqual(fixture.references);

    /* What it wrote, and nothing of the media's. */
    expect(installed.layer.manifest.entries.map((entry) => `${entry.kind} ${entry.path}`)).toEqual([
      'removed WINDOWS\\SYSTEM\\SETUP.REG',
      'folder INSTLAY',
      'folder WINDOWS',
      'folder WINDOWS\\SYSTEM',
      'folder WINDOWS\\TEMP',
      'file INSTLAY\\INSTLAY.INI',
      'file INSTLAY\\INSTLAYC.EXE',
      'file INSTLAY\\README.TXT',
      'file WINDOWS\\INSTLAY.INI',
      'file WINDOWS\\SYSTEM\\INSTLAY.DLL',
      'file WINDOWS\\WIN.INI',
    ]);
    /* Of the media, only the harness's records were written. */
    expect(installed.dropped).toContain('ORACLE\\INSTLAY.OUT');
    expect(
      installed.dropped.every((path) => path === 'ORACLE' || path === 'ORACLE\\INSTLAY.OUT')
    ).toBe(true);
    /* What it wrote that names its media, kept as it wrote it. */
    expect(installed.references.map(({ path, line }) => `${path}: ${line}`)).toEqual([
      'WINDOWS\\WIN.INI: Media=C:\\WINDOWS\\INSTLAYC.EXE',
    ]);
  });
});
