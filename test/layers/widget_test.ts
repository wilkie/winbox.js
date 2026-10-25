'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { installedLayer } from '../../src/layers/install.js';
import { Fat16Changes } from '../../src/run/changes.js';
import { type Plan } from '../../src/run/drive.js';
import { shellAlone } from '../../src/win16/progman/main.js';
import { imageFor, runProbe } from '../win16/run-probe.js';

/**
 * A program of the corpus installed from its CD-ROM, as Windows did it:
 * Widget Workshop's disc (`corpus/manifest.json`, `widget`), its image
 * mounted as D:, on the oracle's 256-colour installation, `D:\INSTALL.EXE`
 * started as Windows started as `WIN D:\INSTALL.EXE` starts it -- Program
 * Manager, Microsoft's, the shell, given it as its command line -- on the
 * virtual clock, and taken through as the recorder took Windows' through
 * (`record.mjs launch --corpus widget`): Continue, Continue past standard
 * mode, a name, the hard disk's installation, its folder, Continue, no
 * registration, Win32s Setup's message and its failure.
 *
 * What it changed of C: is held to what Windows' install changed under
 * DOSBox, file by file, size and SHA-256 (`widget-windows.json`, the
 * recorder's `changes`), but for what is told below; and kept as the layer
 * an install makes of it (`installedLayer`), its media on D: (`D:\`),
 * `widget-layer.json`, which the Rust engine's run of the same install is
 * held to (`crates/winbox-win16/tests/install_widget.rs`).
 *
 * Some six minutes: run where the disc is fetched and `WIDGET_INSTALL=1`
 * asks (`node scripts/corpus/fetch.mjs widget`). `WIDGET_LAYER_WRITE=1`
 * writes the layer's fixture from this run.
 */

const ROOT = join(__dirname, '..', '..');
const ISO = join(ROOT, 'corpus', 'cache', 'widget', 'widget.iso');
const WINDOWS = join(__dirname, 'widget-windows.json');
const FIXTURE = join(__dirname, 'widget-layer.json');
const ready =
  process.env.WIDGET_INSTALL === '1' && existsSync(ISO) && existsSync(imageFor('vga256'));

/** The steps, as the survey and the recorder take them. */
const STEPS = [
  { keys: ['Return'], seconds: 5 },
  { keys: ['Return'], seconds: 5 },
  { keys: ['w', 'i', 'n', 'b', 'o', 'x', 'Return'], seconds: 5 },
  { keys: ['space'], seconds: 5 },
  { keys: ['Return'], seconds: 5 },
  { keys: ['Return'], seconds: 60 },
  { keys: ['n'], seconds: 10 },
  { keys: ['Return'], seconds: 30 },
  { keys: ['Return'], seconds: 20 },
];

/**
 * What WinBox writes otherwise than Windows did, each with why: held to
 * differ, so that the day one comes to agree, it is looked at.
 */
const DIFFERING: Record<string, string> = {
  /* The registration database: the same keys and texts, but Windows' node
   * table has one entry more at its end, free, 215 where WinBox's has 214;
   * how SHELL came to it is not yet read out (`kb/topics/registration-
   * database.md`). */
  'WINDOWS\\REG.DAT': "Windows' node table has one free entry more",
};

(ready ? describe : describe.skip)("Widget Workshop's install from its CD", () => {
  it("changes C: as Windows' install did", async () => {
    let changes: Fat16Changes | null = null;
    const run = await runProbe('widget', 3000, false, true, 20, {
      boxKeys: [['Enter'], ['Enter'], ['Enter']],
      virtual: true,
      keepCalls: 0,
      display: 'vga256',
      own: false,
      brought: false,
      shell: false,
      start: 'D:\\INSTALL.EXE',
      install: true,
      steps: STEPS,
      mounts: [{ letter: 'D', path: ISO, kind: 'iso' }],
      prepare: async (fileSystem) => {
        changes = new Fat16Changes(fileSystem, { placements: [] } as unknown as Plan);
        await changes.mark();
      },
    });

    expect(run.failure ?? null).toBeNull();
    /* The installer and Win32s Setup ended, Program Manager left. */
    expect(shellAlone(run.win16)).toBe(true);

    const made = await changes!.changes();
    const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
    const ours = made
      .map((change) =>
        change.kind === 'file'
          ? {
              kind: 'file',
              path: change.path,
              size: change.data.length,
              sha256: sha256(change.data),
            }
          : { kind: change.kind, path: change.path }
      )
      .sort((one, other) => (one.path < other.path ? -1 : one.path > other.path ? 1 : 0));
    const theirs = JSON.parse(readFileSync(WINDOWS, 'utf8')).changes;
    const line = (change: any) =>
      `${change.kind} ${change.path}${change.kind === 'file' ? ` ${change.size} ${change.sha256}` : ''}`;
    const differing = (change: any) => change.path in DIFFERING;

    /* The recorder tells the folders made; a FAT volume tells a folder
     * whose stamp moved too, as one written in: those are passed over. */
    const folders = new Set(
      theirs.filter((change: any) => change.kind === 'folder').map((change: any) => change.path)
    );
    const told = (change: any) => change.kind !== 'folder' || folders.has(change.path);

    expect(ours.filter((change) => told(change) && !differing(change)).map(line)).toEqual(
      theirs.filter((change: any) => !differing(change)).map(line)
    );

    for (const path of Object.keys(DIFFERING)) {
      expect([path, ours.find((change) => change.path === path)?.sha256]).not.toEqual([
        path,
        theirs.find((change: any) => change.path === path)?.sha256,
      ]);
    }

    /* As a layer: its media on D:, nothing of C: dropped for them; the
     * lines that name `D:\` told. */
    const installed = await installedLayer(made, {
      media: ['D:\\'],
      over: ['install:vga256'],
      made: { by: 'WinBox', from: 'widget.iso' },
    });
    const kept = {
      stepMarks: run.stepMarks.map(({ time, key, code, kind }: any) => ({
        instructions: 0,
        calls: 0,
        time,
        ...(key ? { key, code, kind } : {}),
      })),
      layer: installed.layer.manifest,
      dropped: installed.dropped,
      references: installed.references,
    };

    if (process.env.WIDGET_LAYER_WRITE === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(kept, null, 1)}\n`);
    }

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    expect(kept.layer).toEqual(fixture.layer);
    expect(kept.dropped).toEqual([]);
    expect(kept.references).toEqual(fixture.references);
  }, 1_800_000);
});
