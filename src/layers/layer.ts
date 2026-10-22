/**
 * A layer of drive C: (`kb/formats/layer.md`): what a program's installer,
 * or a program as it ran, added to a drive, deleted of it, or wrote -- kept
 * by itself, content-addressed, to be put over a base and other layers.
 * The manifest, `winbox-layer.json`, lists the layer's entries; a file's
 * bytes are a blob named by their sha256, and its stamp is in its entry, so
 * two files of the same bytes share one blob.
 *
 * A stack is a base (`baseLayer`, composed from the asset bundle and never
 * stored) and layers over it, the lowest first; `flattenStack` gives what
 * C: holds, one flat drive, as the page's drive and the native build's
 * layered host drive must show it.
 *
 * The Rust engine's twin is `crates/winbox-win16/src/layers.rs`; the two
 * give the same ids, the same flattened listing and the same zip bytes
 * (`test/layers/stack.json`).
 */

import { STAMP, type Composed } from '../assets/compose.js';
import { writeStoredZip } from '../assets/zip.js';
import { type Change } from '../run/changes.js';
import { readZip } from '../zip.js';

/** The manifest's format this engine reads and writes. */
export const LAYER_FORMAT = 1;

/** The manifest's name, at the root of the exchange zip. */
export const LAYER_MANIFEST = 'winbox-layer.json';

/**
 * An entry of a layer, its path DOS's beneath the drive's root, upper case:
 * `WINDOWS\WIN.INI`. What it deletes of the layers beneath it (a folder
 * with everything in it); a folder it makes, or whose stamp it moves; a
 * file it makes or writes, as it stands. Stamps are seconds since 1970,
 * local time read as universal, as DOS keeps it.
 */
export type LayerEntry =
  | { kind: 'removed'; path: string }
  | { kind: 'folder'; path: string; modified: number }
  | { kind: 'file'; path: string; sha256: string; size: number; modified: number };

/** Who made a layer: WinBox's part that did, its version, and from what. */
export interface Made {
  by: string;
  version?: string;
  from?: string;
}

export interface LayerManifest {
  format: number;
  /** `layerId` of the entries; a base's is its name, `base:<assets id>:<display>`. */
  id: string;
  /**
   * The stack it was made on, the base first, then the layers' ids, the
   * lowest first; empty for a layer made over nothing (a program's
   * archive as it was dropped).
   */
  over: string[];
  made: Made;
  /** In their canonical order (`orderEntries`). */
  entries: LayerEntry[];
}

/** A layer: its manifest and the blobs its files' bytes are, by sha256. */
export interface Layer {
  manifest: LayerManifest;
  blobs: Map<string, Uint8Array>;
}

/** A folder of a flattened stack, and its stamp. */
export interface FlatFolder {
  path: string;
  modified: number;
}

/** A file of a flattened stack. */
export interface FlatFile {
  path: string;
  sha256: string;
  size: number;
  modified: number;
  data: Uint8Array;
}

/** What a stack holds, as one flat drive: each sorted by path. */
export interface Flat {
  folders: FlatFolder[];
  files: FlatFile[];
}

/** The sha256 of some bytes, in hex, lower case. */
export async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const depth = (path: string) => path.split('\\').length;
const byPath = (one: string, other: string) => (one < other ? -1 : one > other ? 1 : 0);
const RANK = { removed: 0, folder: 1, file: 2 };

/**
 * Entries in their canonical order, the order a layer keeps them and puts
 * them on a drive in: what is deleted first, by path; then the folders, the
 * shallowest first, each depth by path; then the files, by path. Paths are
 * compared byte by byte. A path named twice by one kind is refused.
 */
export function orderEntries<T extends { kind: LayerEntry['kind']; path: string }>(entries: T[]) {
  const ordered = [...entries].sort(
    (one, other) =>
      RANK[one.kind] - RANK[other.kind] ||
      (one.kind === 'folder' ? depth(one.path) - depth(other.path) : 0) ||
      byPath(one.path, other.path)
  );

  ordered.forEach((entry, at) => {
    const before = ordered[at - 1];

    if (before && before.kind === entry.kind && before.path === entry.path) {
      throw new Error(`a layer names ${entry.path} twice`);
    }
  });

  return ordered;
}

/** An entry as the line the id is made of. */
export function entryLine(entry: LayerEntry) {
  switch (entry.kind) {
    case 'removed':
      return `removed ${entry.path}`;
    case 'folder':
      return `folder ${entry.path} ${entry.modified}`;
    case 'file':
      return `file ${entry.path} ${entry.sha256} ${entry.size} ${entry.modified}`;
  }
}

/**
 * A layer's id: the sha256 of its entries' lines (`entryLine`), in their
 * canonical order, joined by line feeds with none after the last -- as the
 * asset bundle's id is the sha256 of its files' hashes, one to a line.
 */
export async function layerId(entries: LayerEntry[]) {
  return sha256(new TextEncoder().encode(orderEntries(entries).map(entryLine).join('\n')));
}

/** A DOS path as a layer keeps it: back slashes, upper case, no slash at either end. */
export function layerPath(path: string) {
  return path
    .replace(/\//g, '\\')
    .split('\\')
    .filter((name) => name !== '')
    .join('\\')
    .toUpperCase();
}

/**
 * A layer of a drive's changes (`src/run/changes.ts`): each file's bytes a
 * blob, its stamp in its entry.
 */
export async function layerFromChanges(
  changes: Change[],
  options: { over?: string[]; made?: Made } = {}
): Promise<Layer> {
  const blobs = new Map<string, Uint8Array>();
  const entries: LayerEntry[] = [];

  for (const change of changes) {
    const path = layerPath(change.path);

    switch (change.kind) {
      case 'removed':
        entries.push({ kind: 'removed', path });
        break;
      case 'folder':
        entries.push({ kind: 'folder', path, modified: change.modified });
        break;
      case 'file': {
        const hash = await sha256(change.data);

        blobs.set(hash, change.data);
        entries.push({
          kind: 'file',
          path,
          sha256: hash,
          size: change.data.length,
          modified: change.modified,
        });
        break;
      }
    }
  }

  const ordered = orderEntries(entries);

  return {
    manifest: {
      format: LAYER_FORMAT,
      id: await layerId(ordered),
      over: [...(options.over ?? [])],
      made: madeOf(options.made),
      entries: ordered,
    },
    blobs,
  };
}

/** Who made a layer, its fields in the manifest's order: as the Rust engine writes them. */
function madeOf(made: Made = { by: 'WinBox' }): Made {
  return {
    by: made.by,
    ...(made.version === undefined ? {} : { version: made.version }),
    ...(made.from === undefined ? {} : { from: made.from }),
  };
}

/** A blob of a layer's, refused where the layer has none. */
function blobOf(layer: Layer, hash: string) {
  const data = layer.blobs.get(hash);

  if (!data) {
    throw new Error(`layer ${layer.manifest.id} has no blob ${hash}`);
  }

  return data;
}

/** A layer as a drive's changes, in its order: what `applyChanges` puts on a drive. */
export function changesFromLayer(layer: Layer): Change[] {
  return layer.manifest.entries.map((entry): Change => {
    switch (entry.kind) {
      case 'removed':
        return { kind: 'removed', path: entry.path };
      case 'folder':
        return { kind: 'folder', path: entry.path, modified: entry.modified };
      case 'file':
        return {
          kind: 'file',
          path: entry.path,
          data: blobOf(layer, entry.sha256),
          modified: entry.modified,
        };
    }
  });
}

/** The name of the base composed from an asset bundle for a display. */
export function baseName(assetsId: string, display: string) {
  return `base:${assetsId}:${display}`;
}

/**
 * The base of C: composed from an asset bundle (`composeBase`) as the
 * lowest layer of a stack: its folders, those it names and those above its
 * files, each stamped `STAMP` as the page's drive and the native build's
 * `write_base` stamp them; its files with their stamps. Named, not hashed
 * (`baseName`): it is made again from the bundle, never stored.
 */
export async function baseLayer(composed: Composed, assetsId: string, display: string) {
  const folders = new Set<string>();
  const above = (path: string) => {
    const names = path.split('\\');

    for (let at = 1; at < names.length; at++) {
      folders.add(names.slice(0, at).join('\\'));
    }
  };
  const blobs = new Map<string, Uint8Array>();
  const entries: LayerEntry[] = [];

  for (const directory of composed.directories) {
    const path = layerPath(directory);

    above(path);
    folders.add(path);
  }

  for (const file of composed.files) {
    const path = layerPath(file.path);
    const hash = await sha256(file.data);

    above(path);
    blobs.set(hash, file.data);
    entries.push({
      kind: 'file',
      path,
      sha256: hash,
      size: file.data.length,
      modified: file.modified,
    });
  }

  for (const path of folders) {
    entries.push({ kind: 'folder', path, modified: STAMP });
  }

  const layer: Layer = {
    manifest: {
      format: LAYER_FORMAT,
      id: baseName(assetsId, display),
      over: [],
      made: { by: 'WinBox' },
      entries: orderEntries(entries),
    },
    blobs,
  };

  return layer;
}

/* ---- stacking ---- */

/** Whether two paths are one, or one is beneath the other. */
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}\\`);

/**
 * Where two layers touch: a path both name, or one beneath what the other
 * deletes. None where they touch nowhere.
 */
export function touching(one: LayerManifest, other: LayerManifest): string | undefined {
  const named = new Set(other.entries.map((entry) => entry.path));
  const removed = (manifest: LayerManifest) =>
    manifest.entries.filter((entry) => entry.kind === 'removed').map((entry) => entry.path);

  for (const entry of one.entries) {
    if (named.has(entry.path)) {
      return entry.path;
    }
  }

  for (const [deleting, naming] of [
    [one, other],
    [other, one],
  ]) {
    for (const folder of removed(deleting)) {
      const found = naming.entries.find((entry) => within(entry.path, folder));

      if (found) {
        return found.path;
      }
    }
  }

  return undefined;
}

/**
 * Whether a stack may be put together, the base first: each layer made
 * over that base or over nothing, the layers it was made over beneath it,
 * and two layers that touch the same path only where the higher was made
 * over the lower (the owner's "install in turn": programs meant to share a
 * machine are installed one after another into one stack). Refused with
 * why; nothing where it may.
 */
export function stackRefusal(stack: LayerManifest[]): string | undefined {
  const base = stack[0]?.id;

  for (let at = 1; at < stack.length; at++) {
    const layer = stack[at];
    const beneath = new Set(stack.slice(0, at).map((below) => below.id));

    if (layer.over.length > 0 && layer.over[0] !== base) {
      return `layer ${layer.id} was made on ${layer.over[0]}, not on ${base}`;
    }

    for (const id of layer.over.slice(1)) {
      if (!beneath.has(id)) {
        return `layer ${layer.id} was made over ${id}, which is not beneath it`;
      }
    }

    for (let below = 0; below < at; below++) {
      const path = touching(stack[below], layer);

      if (path !== undefined && !layer.over.includes(stack[below].id)) {
        return `layers ${stack[below].id} and ${layer.id} both touch ${path}, and neither was made over the other`;
      }
    }
  }

  return undefined;
}

interface FlatNode {
  modified: number;
  /** A folder's entries by name; none for a file. */
  children?: Map<string, FlatNode>;
  file?: { sha256: string; data: Uint8Array };
}

/**
 * A stack, the base first, as one flat drive: each layer's entries put on
 * what is beneath, in their order, as a drive made afresh takes changes
 * (`applyChanges`, Rust's `MemoryDrive::apply`) -- a deleted path let go of
 * with all beneath it; a folder made, and those above it where they are
 * not there, stamped then, or its stamp moved where it is; a file put
 * there, the folders above made as for a folder. Refused as `stackRefusal`
 * refuses it.
 */
export function flattenStack(stack: Layer[]): Flat {
  const refusal = stackRefusal(stack.map((layer) => layer.manifest));

  if (refusal) {
    throw new Error(refusal);
  }

  const root: FlatNode = { modified: 0, children: new Map() };
  const made = (names: string[], modified: number) => {
    let folder = root;

    for (const name of names) {
      let next = folder.children!.get(name);

      if (!next) {
        next = { modified, children: new Map() };
        folder.children!.set(name, next);
      }

      if (!next.children) {
        return undefined;
      }

      folder = next;
    }

    return folder;
  };

  for (const layer of stack) {
    for (const entry of layer.manifest.entries) {
      const names = entry.path.split('\\');
      const name = names[names.length - 1];

      switch (entry.kind) {
        case 'removed': {
          let folder: FlatNode | undefined = root;

          for (const above of names.slice(0, -1)) {
            folder = folder?.children?.get(above);
          }

          folder?.children?.delete(name);
          break;
        }
        case 'folder': {
          const folder = made(names, entry.modified);

          if (folder) {
            folder.modified = entry.modified;
          }

          break;
        }
        case 'file': {
          const folder = made(names.slice(0, -1), entry.modified);

          if (folder && !folder.children!.get(name)?.children) {
            folder.children!.set(name, {
              modified: entry.modified,
              file: { sha256: entry.sha256, data: blobOf(layer, entry.sha256) },
            });
          }

          break;
        }
      }
    }
  }

  const flat: Flat = { folders: [], files: [] };
  const walk = (folder: FlatNode, prefix: string) => {
    for (const [name, node] of folder.children!) {
      const path = prefix ? `${prefix}\\${name}` : name;

      if (node.children) {
        flat.folders.push({ path, modified: node.modified });
        walk(node, path);
      } else {
        flat.files.push({
          path,
          sha256: node.file!.sha256,
          size: node.file!.data.length,
          modified: node.modified,
          data: node.file!.data,
        });
      }
    }
  };

  walk(root, '');
  flat.folders.sort((one, other) => byPath(one.path, other.path));
  flat.files.sort((one, other) => byPath(one.path, other.path));

  return flat;
}

/** A flattened stack as lines, one to an entry: how the two engines' are compared. */
export function flatLines(flat: Flat) {
  return [
    ...flat.folders.map((folder) => `folder ${folder.path} ${folder.modified}`),
    ...flat.files.map((file) => `file ${file.path} ${file.sha256} ${file.size} ${file.modified}`),
  ];
}

/* ---- the exchange zip ---- */

/** A manifest's text, as the exchange zip holds it. */
export function manifestText(manifest: LayerManifest) {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** DOS's first date, 1 January 1980, which the zip's entries carry: a blob has no stamp of its own. */
const ZIP_DATE = 0x0021;

/**
 * A layer as the zip it is exchanged in: stored entries, the manifest
 * first, then each blob its files name, once, as `blobs/<sha256>`, by hash.
 */
export function layerZip(layer: Layer): Uint8Array {
  const hashes = [
    ...new Set(
      layer.manifest.entries.flatMap((entry) => (entry.kind === 'file' ? [entry.sha256] : []))
    ),
  ].sort(byPath);

  return writeStoredZip([
    { path: LAYER_MANIFEST, data: manifestText(layer.manifest), date: ZIP_DATE, time: 0 },
    ...hashes.map((hash) => ({
      path: `blobs/${hash}`,
      data: blobOf(layer, hash),
      date: ZIP_DATE,
      time: 0,
    })),
  ]);
}

/**
 * A layer from its exchange zip. Refused: no manifest, a format this engine
 * does not know, a blob missing or not the bytes its name says, or an id
 * that is not its entries'.
 */
export async function layerFromZip(bytes: Uint8Array): Promise<Layer> {
  const files = new Map((await readZip(bytes)).map((entry) => [entry.path, entry.data]));
  const text = files.get(LAYER_MANIFEST);

  if (!text) {
    throw new Error(`no ${LAYER_MANIFEST}: not a layer`);
  }

  const manifest: LayerManifest = JSON.parse(new TextDecoder().decode(text));

  if (manifest.format !== LAYER_FORMAT) {
    throw new Error(`a layer of format ${manifest.format}: this WinBox reads ${LAYER_FORMAT}`);
  }

  manifest.entries = orderEntries(manifest.entries);

  const blobs = new Map<string, Uint8Array>();

  for (const entry of manifest.entries) {
    if (entry.kind !== 'file' || blobs.has(entry.sha256)) {
      continue;
    }

    const data = files.get(`blobs/${entry.sha256}`);

    if (!data || data.length !== entry.size || (await sha256(data)) !== entry.sha256) {
      throw new Error(`the blob of ${entry.path} is missing or not its bytes`);
    }

    blobs.set(entry.sha256, data);
  }

  if ((await layerId(manifest.entries)) !== manifest.id) {
    throw new Error(`layer ${manifest.id}: its entries' id is not that`);
  }

  return { manifest, blobs };
}
