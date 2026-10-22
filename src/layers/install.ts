/**
 * A program's installer run into a layer (`kb/formats/layer.md`, "An
 * installer into a layer"): the installer runs over a stack, its media
 * placed on C: beneath an empty top, and what it wrote -- the top's changes
 * -- is kept as a layer, the media discarded, as the owner chose. Only the
 * installer's own top is kept: every entry that names a path of the media,
 * or one beneath a folder of it, is dropped. What the installer wrote that
 * still names the media -- a profile's line pointing at its setup folder --
 * is told, not rewritten: a program that reads it later will not find what
 * it names.
 *
 * The Rust engine's twin is `Layer::installed` and `media_references` in
 * `crates/winbox-win16/src/layers.rs`.
 */

import { type Change } from '../run/changes.js';
import { type Layer, layerFromChanges, layerPath, type Made } from './layer.js';

/** Whether a path is a folder's, or beneath it. */
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}\\`);

/**
 * A drive's changes without those naming the media: a path of the media,
 * as a layer keeps it (`layerPath`), or one beneath a folder of it. What is
 * kept, and the paths dropped.
 */
export function dropMedia(changes: Change[], media: string[]) {
  const paths = media.map(layerPath).filter((path) => path !== '');
  const kept: Change[] = [];
  const dropped: string[] = [];

  for (const change of changes) {
    const path = layerPath(change.path);

    if (paths.some((one) => within(path, one))) {
      dropped.push(path);
    } else {
      kept.push(change);
    }
  }

  return { kept, dropped };
}

/** A line of a file the installer wrote that names the media. */
export interface MediaReference {
  /** The file, as a layer names it: `WINDOWS\WIN.INI`. */
  path: string;

  /** The line, as the file has it, its bytes read as Latin-1. */
  line: string;
}

/**
 * The lines of a layer's files that name a path of the media, its DOS
 * path with the drive's letter, `C:\SETUP`, in any case: what the installer
 * wrote that refers to what is not kept. A file with a nought byte in it is
 * not text, and is passed over: a program's own code names paths too. Each
 * file's lines are split at line feeds, a carriage return before one left
 * off.
 */
export function mediaReferences(layer: Layer, media: string[]): MediaReference[] {
  const names = media
    .map(layerPath)
    .filter((path) => path !== '')
    .map((path) => `C:\\${path}`);
  const found: MediaReference[] = [];

  for (const entry of layer.manifest.entries) {
    const data = entry.kind === 'file' ? layer.blobs.get(entry.sha256) : undefined;

    if (!data || data.includes(0)) {
      continue;
    }

    const text = latin1(data);
    const upper = text.toUpperCase();

    if (!names.some((name) => upper.includes(name))) {
      continue;
    }

    for (const line of text.split('\n')) {
      const bare = line.replace(/\r$/, '');

      if (names.some((name) => bare.toUpperCase().includes(name))) {
        found.push({ path: entry.path, line: bare });
      }
    }
  }

  return found;
}

function latin1(data: Uint8Array) {
  let text = '';

  for (let at = 0; at < data.length; at += 0x8000) {
    text += String.fromCharCode(...data.subarray(at, at + 0x8000));
  }

  return text;
}

/** What `installedLayer` makes: the layer, the paths dropped, and what names the media. */
export interface Installed {
  layer: Layer;
  dropped: string[];
  references: MediaReference[];
}

/**
 * The layer an installer made: the top's changes as a layer over the stack
 * it ran on (`over`, the base's name first), those naming the media
 * dropped (`dropMedia`), and the lines of what it kept that name the media.
 */
export async function installedLayer(
  changes: Change[],
  { media, over, made }: { media: string[]; over: string[]; made?: Made }
): Promise<Installed> {
  const { kept, dropped } = dropMedia(changes, media);
  const layer = await layerFromChanges(kept, { over, made });

  return { layer, dropped, references: mediaReferences(layer, media) };
}
