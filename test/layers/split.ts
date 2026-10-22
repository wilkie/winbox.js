'use strict';

import type { Assets } from '../../src/assets/bundle.js';
import { STAMP } from '../../src/assets/compose.js';
import {
  LAYER_FORMAT,
  baseLayer,
  flattenStack,
  layerId,
  orderEntries,
  sha256,
  stackRefusal,
  type Flat,
  type Layer,
  type LayerEntry,
} from '../../src/layers/layer.js';

/**
 * `WINBOX_BASE=layers`: the asset bundle's base for a display split into a
 * stack of layers (`kb/formats/layer.md`), as programs installed in turn
 * would make one, each layer made over all those beneath it, and flattened
 * (`flattenStack`) onto the run's FAT16 volume (`run-probe.ts`). What a
 * program sees must be what it sees on `WINBOX_BASE=assets`, the same base
 * made on the volume directly; `test/layers/sweep_test.ts` holds every probe
 * to that. The Rust harness's twin is `tests/support/layered.rs`, which puts
 * the same stack together with `HostDrive::layered`.
 *
 * The stack, the lowest first:
 *
 * 1. the base's folders and files outside `WINDOWS\SYSTEM` that are not
 *    fonts or profiles: `WINDOWS`, `WINDOWS\TEMP`, `REG.DAT`;
 * 2. `WINDOWS\SYSTEM`, and its files that are not fonts or profiles;
 * 3. the fonts, `.FON`, `.FOT` and `.TTF`;
 * 4. the profiles, `.INI`;
 * 5. a decoy: a folder at the root, one in `WINDOWS`, and a file in each and
 *    in `WINDOWS\SYSTEM`, none of them the base's;
 * 6. the decoy's whiteout, each of those removed;
 * 7. the base's profiles, `MIDIMAP.CFG` and its first font again, and
 *    `WINDOWS\SYSTEM`'s stamp, each as the base has it: files shadowed by
 *    the same bytes and stamp.
 */

const DECOY_FOLDERS = ['DECOY', 'WINDOWS\\DECOY'];
const DECOY_FILES = [
  'DECOY\\DECOY.TXT',
  'WINDOWS\\DECOY.INI',
  'WINDOWS\\DECOY\\DECOY.TXT',
  'WINDOWS\\SYSTEM\\DECOY.DLL',
];
/** 1 January 2021, noon. */
const DECOY_STAMP = 1_609_502_400;
const WHITEOUT = ['DECOY', 'WINDOWS\\DECOY', 'WINDOWS\\DECOY.INI', 'WINDOWS\\SYSTEM\\DECOY.DLL'];

const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}\\`);

/** Which of the first four layers a base's entry goes in. */
function group(entry: LayerEntry) {
  const file = entry.kind === 'file';

  if (file && ['.FON', '.FOT', '.TTF'].some((end) => entry.path.endsWith(end))) {
    return 2;
  }

  if (file && entry.path.endsWith('.INI')) {
    return 3;
  }

  return within(entry.path, 'WINDOWS\\SYSTEM') ? 1 : 0;
}

/** A layer of entries made over the layers given, its blobs from `from`. */
async function madeOver(entries: LayerEntry[], beneath: Layer[], from: Map<string, Uint8Array>) {
  const ordered = orderEntries(entries);
  const blobs = new Map<string, Uint8Array>();

  for (const entry of ordered) {
    if (entry.kind === 'file') {
      blobs.set(entry.sha256, from.get(entry.sha256)!);
    }
  }

  const layer: Layer = {
    manifest: {
      format: LAYER_FORMAT,
      id: await layerId(ordered),
      over: beneath.map((below) => below.manifest.id),
      made: { by: 'WinBox', from: 'WINBOX_BASE=layers' },
      entries: ordered,
    },
    blobs,
  };

  return layer;
}

/** The base split into the stack above, the lowest first, each layer made over all those beneath it. */
export async function splitBase(base: Layer) {
  const blobs = new Map(base.blobs);
  const groups: LayerEntry[][] = [[], [], [], []];

  for (const entry of base.manifest.entries) {
    groups[group(entry)].push(entry);
  }

  const decoyBytes = new TextEncoder().encode("A decoy of WinBox's: a layer above removes it.\r\n");
  const decoyHash = await sha256(decoyBytes);

  blobs.set(decoyHash, decoyBytes);

  const decoy: LayerEntry[] = [
    ...DECOY_FOLDERS.map((path) => ({ kind: 'folder' as const, path, modified: DECOY_STAMP })),
    ...DECOY_FILES.map((path) => ({
      kind: 'file' as const,
      path,
      sha256: decoyHash,
      size: decoyBytes.length,
      modified: DECOY_STAMP,
    })),
  ];
  const whiteout: LayerEntry[] = WHITEOUT.map((path) => ({ kind: 'removed' as const, path }));
  const firstFont = base.manifest.entries.find(
    (entry) => entry.kind === 'file' && entry.path.endsWith('.FON')
  );
  const same = base.manifest.entries.filter((entry) =>
    entry.kind === 'file'
      ? entry.path.endsWith('.INI') ||
        entry.path === 'WINDOWS\\SYSTEM\\MIDIMAP.CFG' ||
        entry.path === firstFont?.path
      : entry.kind === 'folder' && entry.path === 'WINDOWS\\SYSTEM' && entry.modified === STAMP
  );
  const stack: Layer[] = [];

  for (const entries of [...groups, decoy, whiteout, same]) {
    stack.push(await madeOver(entries, stack, blobs));
  }

  const refusal = stackRefusal(stack.map((layer) => layer.manifest));

  if (refusal) {
    throw new Error(`the split base is refused: ${refusal}`);
  }

  return stack;
}

const stacks = new Map<string, Promise<{ stack: Layer[]; flat: Flat }>>();

/** The bundle's base for a display, split (`splitBase`) and flattened, once. */
export function layeredBase(assets: Assets, display: string) {
  const key = `${assets.id}:${display}`;

  if (!stacks.has(key)) {
    stacks.set(
      key,
      (async () => {
        const stack = await splitBase(await baseLayer(assets.compose(display), assets.id, display));

        return { stack, flat: flattenStack(stack) };
      })()
    );
  }

  return stacks.get(key)!;
}
