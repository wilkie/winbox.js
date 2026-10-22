'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Composed } from '../../src/assets/compose.js';
import { Machine } from '../../src/emulator/machine.js';
import { baseLayer, layerFromChanges, sha256, type Layer } from '../../src/layers/layer.js';
import { type Change, Fat16Changes } from '../../src/run/changes.js';
import {
  type Archive,
  fillDrive,
  type Plan,
  planDrive,
  programLayer,
  type Stack,
} from '../../src/run/drive.js';
import { changesKey, programChangesKey, programIdentity } from '../../src/run/store.js';
import { type ZipEntry } from '../../src/zip.js';
import { bundle } from '../win16/run-probe.js';

/**
 * The page's C: from a stack of layers (`kb/formats/layer.md`,
 * `planDrive`'s `stack`): the TypeScript engine's volume filled from it
 * holds what the stack flattened holds, folders, files and stamps, as
 * `test/layers/stack.json` has it; and a program's archive kept as a layer
 * over the base makes the drive the archive dropped loose made before,
 * sector for sector. `stack-plan.json` is the plan of the fixture's stack,
 * which `crates/winbox-web/tests/layers_page.rs` fills the Rust engine's
 * drive from as the page does; LAYERS_UPDATE=1 writes it.
 */

const FIXTURE = join(__dirname, '..', 'layers', 'stack.json');
const PLAN = join(__dirname, 'stack-plan.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

function base(): Composed {
  return {
    directories: fixture.base.directories,
    files: fixture.base.files.map(([path, text, modified]: [string, string, number]) => ({
      path,
      data: bytes(text),
      modified,
    })),
  };
}

function changesOf(name: string): Change[] {
  return fixture.layers[name].changes.map((change: any[]): Change => {
    switch (change[0]) {
      case 'removed':
        return { kind: 'removed', path: change[1] };
      case 'folder':
        return { kind: 'folder', path: change[1], modified: change[2] };
      default:
        return { kind: 'file', path: change[1], data: bytes(change[2]), modified: change[3] };
    }
  });
}

async function layers() {
  const made = new Map<string, Layer>();

  made.set('base', await baseLayer(base(), fixture.base.assets, fixture.base.display));

  for (const name of ['A', 'B', 'C', 'D']) {
    const spec = fixture.layers[name];

    made.set(
      name,
      await layerFromChanges(changesOf(name), {
        over: spec.over.map((other: string) => made.get(other)!.manifest.id),
        made: spec.made,
      })
    );
  }

  return made;
}

/** A stack of the fixture's layers, by name, over its base. */
function stackOf(made: Map<string, Layer>, names: string[]): Stack {
  return {
    base: made.get('base')!.manifest.id,
    layers: names.filter((name) => name !== 'base').map((name) => ({ layer: made.get(name)! })),
  };
}

/** What a TypeScript engine's volume holds, as a flattened stack's lines: every folder and file, each stamp. */
async function listed(machine: any, plan: Plan) {
  const drive = await fillDrive(machine, plan);

  /* Told against nothing, as a drive never marked: everything on it. */
  const everything = await new Fat16Changes(drive.fileSystem, {
    ...plan,
    placements: [],
  }).changes();
  const folders: string[] = [];
  const files: string[] = [];

  for (const change of everything) {
    if (change.kind === 'folder') {
      folders.push(`${change.path}\u0000folder ${change.path} ${change.modified}`);
    } else if (change.kind === 'file') {
      files.push(
        `${change.path}\u0000file ${change.path} ${await sha256(change.data)} ${change.data.length} ${change.modified}`
      );
    }
  }

  const byPath = (one: string, other: string) => (one < other ? -1 : one > other ? 1 : 0);

  return [...folders.sort(byPath), ...files.sort(byPath)].map((line) => line.split('\u0000')[1]);
}

/** A machine's first disk, block by block, as media_test compares the harness's. */
const blocks = (machine: any) =>
  Array.from(machine.disks[0]._blocks as (DataView | undefined)[], (block) =>
    block ? Buffer.from(block.buffer, block.byteOffset, block.byteLength).toString('base64') : null
  );

/** A program's archive as `readZip` gives one: dated entries, long names, a folder below, in no order of names. */
function archive(): Archive {
  const entry = (path: string, text: string, modified?: number): ZipEntry =>
    modified === undefined ? { path, data: bytes(text) } : { path, data: bytes(text), modified };
  const exe = new Uint8Array(0x60);

  exe.set([0x4d, 0x5a]);
  exe[0x3c] = 0x40;
  exe.set([0x4e, 0x45], 0x40);

  return {
    name: 'SkiFree.zip',
    entries: [
      { path: 'SKI.EXE', data: exe, modified: 700197000 },
      entry('Long File Name 2.txt', 'two', 700197004),
      entry('DATA/LEVEL.DAT', 'level'.repeat(2000), 700197006),
      entry('Long File Name 1.txt', 'one'),
      entry('DATA/DEEP/ZED.TXT', 'zed', 700197008),
      entry('ABOUT.TXT', 'about', 700197010),
    ],
  };
}

test('the TypeScript volume filled from a stack holds what the stack flattened holds', async () => {
  const made = await layers();
  const plan = planDrive([], null, base(), stackOf(made, fixture.stacks[0].layers));

  /* A FAT entry keeps its stamp to two seconds: an odd second is the even one before it. */
  const toTwoSeconds = (line: string) =>
    line.replace(/ (\d+)$/, (_, stamp) => ` ${Number(stamp) - (Number(stamp) % 2)}`);

  expect(await listed(new Machine(), plan)).toEqual(fixture.expected.flat.map(toTwoSeconds));

  /* The plan the Rust engine's drive is filled from, as the page fills it. */
  const now = {
    about:
      "The page's plan of test/layers/stack.json's first stack (src/run/drive.ts, planDrive with a stack): what both engines fill C: with, in order -- the folders, the files, then the folders the layers make or stamp. Written by test/run/layers_test.ts with LAYERS_UPDATE=1; crates/winbox-web/tests/layers_page.rs fills the Rust engine's drive from it.",
    stack: fixture.stacks[0].layers,
    folders: plan.folders.map(({ parts, modified }) => [parts.join('\\'), modified]),
    placements: await Promise.all(
      plan.placements.map(async ({ parts, data, modified }) => [
        parts.join('\\'),
        await sha256(data),
        modified,
      ])
    ),
    stamps: plan.stamps.map(({ parts, modified }) => [parts.join('\\'), modified]),
  };

  if (process.env.LAYERS_UPDATE) {
    writeFileSync(PLAN, `${JSON.stringify(now, null, 2)}\n`);
  }

  expect(now).toEqual(JSON.parse(readFileSync(PLAN, 'utf8')));
});

test('a stack the format refuses is refused on the page too', async () => {
  const made = await layers();

  for (const stack of fixture.stacks.filter((one: any) => one.refused)) {
    expect(() => planDrive([], null, base(), stackOf(made, stack.layers))).toThrow(stack.refused);
  }

  /* A layer made on another base. */
  const other = { ...stackOf(made, ['base', 'A']), base: 'base:other:vga' };

  expect(() => planDrive([], null, base(), other)).toThrow('was made on');
});

describe("a program's archive kept as a layer", () => {
  /** Today's drive, the archive dropped loose, and the drive of the base and its layer. */
  async function both(windows: Archive | null, composed: Composed | null, name: string) {
    const dropped = archive();
    const loose = planDrive([dropped], windows, composed);
    const made = await programLayer(dropped, windows, composed);
    const stacked = planDrive([], windows, composed, {
      base: name,
      layers: [{ layer: made.layer, order: made.order }],
    });
    const before: any = new Machine();
    const after: any = new Machine();

    await fillDrive(before, loose);
    await fillDrive(after, stacked);

    return { loose, stacked, made, before, after };
  }

  it("makes the drive the archive dropped loose made, sector for sector, on the bundle's base", async () => {
    const { loose, stacked, made, before, after } = await both(null, base(), 'base:fixture:vga');

    expect(blocks(after)).toEqual(blocks(before));
    expect(stacked.files).toEqual(loose.files);
    expect(stacked.programs).toEqual(loose.programs);
    expect(made.programs).toEqual(['C:\\SKIFREE\\SKI.EXE']);
    expect(made.layer.manifest.over).toEqual([]);

    /* Its folders made at the page's stamp, as the volume makes one for a file. */
    expect(
      made.layer.manifest.entries
        .filter((entry) => entry.kind === 'folder')
        .map((entry) => entry.path)
    ).toEqual(['SKIFREE', 'SKIFREE\\DATA', 'SKIFREE\\DATA\\DEEP']);
    expect(new Set(stacked.stamps.map(({ modified }) => modified))).toEqual(
      new Set([Date.UTC(2020, 0, 6, 10, 20, 40) / 1000])
    );
  });

  it('makes the drive the archive dropped loose made, sector for sector, on an installation', async () => {
    const installation: Archive = {
      name: 'win31.zip',
      entries: [
        { path: 'WINDOWS/WIN.INI', data: bytes('[windows]\r\n'), modified: 700197000 },
        { path: 'WINDOWS/SYSTEM/VGASYS.FON', data: bytes('font'), modified: 700197000 },
      ],
    };
    const { before, after, stacked, loose } = await both(installation, null, 'install:feed');

    expect(blocks(after)).toEqual(blocks(before));
    expect(stacked.files).toEqual(loose.files);
  });

  const made = bundle();

  (made ? it : it.skip)(
    "makes the drive the archive dropped loose made, sector for sector, on the asset bundle's base",
    async () => {
      const { before, after } = await both(null, made!.compose('vga'), `base:${made!.id}:vga`);

      expect(blocks(after).filter(Boolean).length).toBeGreaterThan(10);
      expect(blocks(after)).toEqual(blocks(before));
    },
    60000
  );

  it("never replaces a file of Windows', named beside it as the archive dropped loose is", async () => {
    const dropped: Archive = {
      name: 'windows.zip',
      entries: [{ path: 'WIN.INI', data: bytes('[mine]\r\n') }],
    };
    const made = await programLayer(dropped, null, base());

    expect(made.order).toEqual(['WINDOWS\\WIN~1.INI']);
    expect(planDrive([dropped], null, base()).files).toContain('C:\\WINDOWS\\WIN~1.INI');
  });

  it('keeps what a program writes under its name, told against its stack', () => {
    const one = programIdentity('Ski: Free', 'base:feed:vga', 'vga', ['aa', 'bb']);

    expect(changesKey(one)).toBe('C:program:Ski: Free');
    expect(changesKey(one)).toBe(programChangesKey('Ski: Free'));
    expect(programIdentity('Ski: Free', 'base:feed:vga', 'vga', ['aa'])).not.toBe(one);
    expect(changesKey(programIdentity('Ski', 'base:feed:ega', 'ega', ['aa']))).toBe(
      'C:program:Ski'
    );
  });
});
