'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Composed } from '../../src/assets/compose.js';
import {
  baseLayer,
  changesFromLayer,
  flatLines,
  flattenStack,
  layerFromChanges,
  layerFromZip,
  layerId,
  layerZip,
  sha256,
  stackRefusal,
  type Layer,
  type LayerManifest,
} from '../../src/layers/layer.js';
import { orderChanges, type Change } from '../../src/run/changes.js';

/**
 * The layer format (`kb/formats/layer.md`), held to `stack.json`, which the
 * Rust engine's `crates/winbox-win16/tests/layers.rs` is held to as well:
 * the same ids, the same flattened listing and the same zip bytes. With
 * LAYERS_UPDATE=1 this writes the fixture's `expected`.
 */

const FIXTURE = join(__dirname, 'stack.json');
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

/** Every layer of the fixture, by name, each `over` named by the ids it names. */
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

async function expected() {
  const made = await layers();
  const ids: Record<string, string> = {};
  const zips: Record<string, string> = {};

  for (const [name, layer] of made) {
    ids[name] = layer.manifest.id;

    if (name !== 'base') {
      zips[name] = await sha256(layerZip(layer));
    }
  }

  return {
    ids,
    zips,
    flat: flatLines(flattenStack(fixture.stacks[0].layers.map((name: string) => made.get(name)!))),
  };
}

test('the fixture is what this engine makes of it', async () => {
  const now = await expected();

  if (process.env.LAYERS_UPDATE) {
    fixture.expected = now;
    writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  }

  expect(now).toEqual(fixture.expected);
});

test("a layer's id is the sha256 of its entries' lines, in order", async () => {
  const made = await layers();
  const a = made.get('A')!;
  const lines = [
    'removed WINDOWS\\HELP',
    'removed WINDOWS\\README.TXT',
    'folder GAME 770472000',
    'folder GAME\\DATA 770472002',
    'folder WINDOWS\\HELP 770472001',
    'folder WINDOWS\\SYSTEM 770472000',
  ];

  expect(a.manifest.entries.slice(0, 6).map((entry) => entry.path)).toEqual(
    lines.map((line) => line.split(' ')[1])
  );
  expect(a.manifest.id).toBe(await layerId([...a.manifest.entries].reverse()));
  expect(a.manifest.id).toBe(
    await sha256(
      bytes(
        a.manifest.entries
          .map((entry) =>
            entry.kind === 'file'
              ? `file ${entry.path} ${entry.sha256} ${entry.size} ${entry.modified}`
              : entry.kind === 'folder'
                ? `folder ${entry.path} ${entry.modified}`
                : `removed ${entry.path}`
          )
          .join('\n')
      )
    )
  );
  // The empty layer's id is the sha256 of nothing.
  expect(await layerId([])).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test("a layer's changes are the changes it was made of, in the order they are put back", async () => {
  const made = await layers();

  for (const name of ['A', 'B', 'C', 'D']) {
    const back = changesFromLayer(made.get(name)!);
    const given = orderChanges(changesOf(name));

    expect(back.map((change) => change.kind + ' ' + change.path).sort()).toEqual(
      given.map((change) => change.kind + ' ' + change.path).sort()
    );
    // Removed, then folders shallowest first, then files.
    expect(orderChanges(back)).toEqual(back);
  }

  await expect(
    layerFromChanges([
      { kind: 'removed', path: 'A' },
      { kind: 'removed', path: 'a' },
    ])
  ).rejects.toThrow('twice');
});

test('a layer read back from its zip is the layer, and a zip that lies is refused', async () => {
  const made = await layers();
  const b = made.get('B')!;
  const zip = layerZip(b);
  const back = await layerFromZip(zip);

  expect(back.manifest).toEqual(b.manifest);
  expect([...back.blobs.keys()].sort()).toEqual([...b.blobs.keys()].sort());
  // Two files of the same bytes: one blob.
  expect(b.blobs.size).toBe(2);

  const broken = zip.slice();
  const at = new TextDecoder('latin1').decode(broken).indexOf('saved');

  broken[at] = 'S'.charCodeAt(0);
  await expect(layerFromZip(broken)).rejects.toThrow();
});

test('stacks are refused as the fixture says, and a layer made on another base', async () => {
  const made = await layers();

  for (const stack of fixture.stacks) {
    const manifests = stack.layers.map((name: string) => made.get(name)!.manifest);
    const refusal = stackRefusal(manifests);

    if (stack.refused) {
      expect(refusal).toContain(stack.refused);
      expect(() => flattenStack(stack.layers.map((name: string) => made.get(name)!))).toThrow(
        stack.refused
      );
    } else {
      expect(refusal).toBeUndefined();
    }
  }

  const other: LayerManifest = {
    ...made.get('base')!.manifest,
    id: 'base:fixture:ega',
  };

  expect(stackRefusal([other, made.get('A')!.manifest])).toContain('was made on');
});

test('the flattened stack shows the opaque folder alone and the whiteouts gone', async () => {
  const lines: string[] = fixture.expected.flat;

  expect(lines).toContain('folder WINDOWS\\HELP 770472001');
  expect(lines.some((line) => line.includes('ONE.HLP') || line.includes('TWO.HLP'))).toBe(false);
  expect(lines.some((line) => line.includes('WINDOWS\\README.TXT'))).toBe(false);
  expect(lines.some((line) => line.includes('LEVEL1.DAT'))).toBe(false);
  expect(lines).toContain('folder GAME\\DATA 789039010');
});
