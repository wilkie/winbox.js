'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installedLayer, type Installed } from '../../src/layers/install.js';
import { baseName, changesFromLayer } from '../../src/layers/layer.js';
import { applyChanges, fat16Drive, Fat16Changes } from '../../src/run/changes.js';
import { type Plan } from '../../src/run/drive.js';
import {
  PROBES,
  bundle,
  chosenBase,
  imageFor,
  outputOf,
  recordsFrom,
  runProbe,
} from '../win16/run-probe.js';

/**
 * An installer run into a layer (`kb/formats/layer.md`, "An installer into
 * a layer"), held to the oracle: `instlay` installs a program, and the
 * program it installed, `INSTLAYC.EXE`, reads back what it left, both
 * recorded in one DOSBox session (`oracle/probes/instlay.c`,
 * `instlay.child.c`).
 *
 * Here the installer runs on the base `WINBOX_BASE` chooses, its media --
 * itself and the program beside it in `C:\WINDOWS`, where the recorder puts
 * them -- placed on C: before the drive's changes are marked, so the top is
 * empty, and writes what Windows wrote. Its changes are made a layer over
 * the base, the media discarded (`installedLayer`), and the installed
 * program run alone on the base and that layer reads back what it read
 * back on Windows, record for record. The Rust engine's twin is
 * `crates/winbox-win16/tests/install_layer.rs`.
 */

const FIXTURE = join(__dirname, '..', '..', 'oracle', 'fixtures', 'instlay.json');
const INSTALLER = join(PROBES, 'INSTLAY.EXE');
const base = chosenBase();
const ready =
  existsSync(FIXTURE) &&
  existsSync(INSTALLER) &&
  existsSync(imageFor('vga')) &&
  (base === 'installed' || bundle() !== null);

/** The installer's media, where the recorder puts them, and where the harness keeps its records. */
const MEDIA = ['WINDOWS\\INSTLAY.EXE', 'WINDOWS\\INSTLAYC.EXE', 'ORACLE'];

const recorded: string[] = ready
  ? JSON.parse(readFileSync(FIXTURE, 'utf8')).records.map(
      (record: any) => `${record.function}(${record.args}) = ${record.result}`
    )
  : [];

const options = { virtual: true, keepCalls: 0, base, display: 'vga' };

/** The installer run over the base, its media placed and the drive marked: its records and its layer. */
async function install(): Promise<{ records: string[]; installed: Installed; failure: any }> {
  let changes: Fat16Changes | null = null;

  const run = await runProbe('instlay', 4000, false, true, 30, {
    ...options,
    own: false,
    start: 'C:\\WINDOWS\\INSTLAY.EXE',
    prepare: async (fileSystem) => {
      await fileSystem.map(
        ['WINDOWS', 'INSTLAY.EXE'],
        new DataView(new Uint8Array(readFileSync(INSTALLER)).buffer)
      );
      changes = new Fat16Changes(fileSystem, { placements: [] } as unknown as Plan);
      await changes.mark();
    },
  });
  const over = [base === 'installed' ? 'install:vga' : baseName(bundle()!.id, 'vga')];
  const installed = await installedLayer(await changes!.changes(), {
    media: MEDIA,
    over,
    made: { by: 'WinBox probe harness', from: 'instlay' },
  });

  return {
    records: recordsFrom((await outputOf(run.fileSystem, 'instlay')) ?? ''),
    installed,
    failure: run.failure,
  };
}

/** The program installed run alone on the base and the installer's layer: its records. */
async function installedProgram(installed: Installed) {
  const run = await runProbe('instlay', 4000, false, true, 30, {
    ...options,
    own: false,
    brought: false,
    start: 'C:\\INSTLAY\\INSTLAYC.EXE',
    prepare: (fileSystem) =>
      applyChanges(changesFromLayer(installed.layer), fat16Drive(fileSystem)),
  });

  return {
    records: recordsFrom((await outputOf(run.fileSystem, 'instlay')) ?? ''),
    failure: run.failure,
  };
}

(ready ? describe : describe.skip)('an installer run into a layer', () => {
  it('writes as Windows did, and the program it installed reads back the same on its layer', async () => {
    const { records, installed, failure } = await install();

    expect(failure ?? null).toBeNull();
    expect(records).toEqual(recorded);

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

    const program = await installedProgram(installed);

    expect(program.failure ?? null).toBeNull();
    expect(program.records).toEqual(recorded.filter((record) => record.startsWith('c.')));
  }, 600_000);
});
