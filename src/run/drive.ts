'use strict';

import { type Composed } from '../assets/compose.js';
import { FAT16 } from '../file-systems/fat16.js';
import {
  type Layer,
  type LayerEntry,
  layerFromChanges,
  type LayerManifest,
  LAYER_FORMAT,
  stackRefusal,
} from '../layers/layer.js';
import { type ZipEntry } from '../zip.js';
import { type Change, fat16Drive } from './changes.js';

/**
 * Puts dropped archives onto the machine's C: drive. Where each file goes, and
 * its 8.3 name, is worked out once (`planDrive`), and each engine fills its
 * own drive from that: the TypeScript engine a FAT16 volume made in memory --
 * the same file system the tests and the oracle's drive image use --, the
 * Rust engine its drive held in memory, a file at a time. Either way a
 * program sees the same 8.3 names and the same directory structure.
 *
 * A Windows installation is recognised by what it holds, a `SYSTEM` directory
 * of fonts, wherever it sits in its archive, and goes to `C:\WINDOWS`, which is
 * where the system looks for its fonts. In its place the page may have the
 * base an asset bundle composes for the display (`compose.ts`), laid out where
 * Setup put each file. Every other archive gets a directory of its own, named
 * after it.
 */

export interface Archive {
  /** The archive's file name, which names its directory. */
  name: string;
  entries: ZipEntry[];
}

export interface Program {
  /** Where it is, as a program would name it: `C:\GAMES\SKI.EXE`. */
  path: string;

  /** The same path as the drive's parts, for opening it. */
  parts: string[];

  /** What it is: a Windows program, or a DOS one, which is not run here. */
  kind: 'windows' | 'dos';
}

export interface Drive {
  fileSystem: any;
  files: string[];
  programs: Program[];

  /** Whether a Windows installation was found and placed. */
  windows: boolean;

  /** Names that were not valid 8.3 names, and what they became. */
  renamed: { from: string; to: string }[];
}

/** The characters a DOS name may hold, apart from letters and digits. */
const ALLOWED = /[^A-Z0-9!#$%&'()\-@^_`{}~]/g;

/**
 * An 8.3 name for a name that may not be one: upper case, invalid characters
 * dropped, and a base longer than eight kept to six and numbered with `~`,
 * against the names already used in the same directory.
 */
function shortName(name: string, taken: Set<string>) {
  const dot = name.lastIndexOf('.');
  const rawBase = (dot > 0 ? name.slice(0, dot) : name).toUpperCase();
  const rawExt = (dot > 0 ? name.slice(dot + 1) : '').toUpperCase();
  const base = rawBase.replace(ALLOWED, '');
  const ext = rawExt.replace(ALLOWED, '').slice(0, 3);
  const plain = `${base}${ext ? `.${ext}` : ''}`;

  if (base && base.length <= 8 && base === rawBase && ext === rawExt && !taken.has(plain)) {
    taken.add(plain);
    return plain;
  }

  for (let number = 1; ; number++) {
    const tail = `~${number}`;
    const candidate = `${(base || 'FILE').slice(0, 8 - tail.length)}${tail}${ext ? `.${ext}` : ''}`;

    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** What an executable is, from its headers. */
function kindOf(data: Uint8Array): Program['kind'] | null {
  if (data.length < 0x40 || data[0] !== 0x4d || data[1] !== 0x5a) {
    return null;
  }

  const header = data[0x3c] | (data[0x3d] << 8) | (data[0x3e] << 16) | (data[0x3f] << 24);

  return header > 0 &&
    header + 1 < data.length &&
    data[header] === 0x4e &&
    data[header + 1] === 0x45
    ? 'windows'
    : 'dos';
}

/** Where in an archive a Windows installation's root is, if it holds one. */
function windowsRoot(entries: ZipEntry[]) {
  for (const entry of entries) {
    const match = /^(.*?)SYSTEM\/[^/]+\.(FON|TTF)$/i.exec(entry.path);

    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * The display driver a Windows installation runs with: the file `SYSTEM.INI`
 * names as `display.drv`, from its `SYSTEM` directory. Its OEM bitmaps are
 * what USER draws window frames with.
 */
export function systemFileOf(windows: Archive, name: string) {
  const root = windowsRoot(windows.entries);

  if (root === null) {
    return null;
  }

  return (
    windows.entries.find(
      (entry) => entry.path.toUpperCase() === `${root}SYSTEM/${name}`.toUpperCase()
    )?.data ?? null
  );
}

export function displayDriverOf(windows: Archive) {
  const root = windowsRoot(windows.entries);

  if (root === null) {
    return null;
  }

  const find = (path: string) =>
    windows.entries.find((entry) => entry.path.toUpperCase() === (root + path).toUpperCase());
  const ini = find('SYSTEM.INI');

  if (!ini) {
    return null;
  }

  const text = new TextDecoder('latin1').decode(ini.data);
  const name = /^\s*display\.drv\s*=\s*(\S+)/im.exec(text)?.[1];

  return name ? (find(`SYSTEM/${name}`)?.data ?? null) : null;
}

/** A file as both engines put it on C:, from what was dropped. */
export interface Placement {
  /** Its DOS path's parts beneath `C:\`, as 8.3 names. */
  parts: string[];
  data: Uint8Array;

  /** Where it was in what was dropped: `Games.zip/Long File Name.txt`. */
  original: string;

  /** When it was last written, in seconds since 1970, read as DOS keeps local time. */
  modified: number;
}

/** A folder both engines make on C:, whether or not anything is placed in it. */
export interface Folder {
  /** Its DOS path's parts beneath `C:\`. */
  parts: string[];

  /** When it was last written, as a placement's. */
  modified: number;
}

/** What goes on C:, worked out once and filled in by whichever engine runs. */
export interface Plan {
  /** The folders made first: the asset bundle's base's (`WINDOWS\TEMP`), where it is placed. */
  folders: Folder[];
  placements: Placement[];

  /**
   * The folders a stack's layers make or stamp (`planDrive`'s `layers`),
   * made, or their stamps set, once every file is placed: shallowest
   * first, each depth by path. None for a drive of loose archives alone.
   */
  stamps: Folder[];
  files: string[];
  programs: Program[];

  /** Whether a Windows installation, or an asset bundle's base, was found and placed. */
  windows: boolean;

  /** Names that were not valid 8.3 names, and what they became. */
  renamed: { from: string; to: string }[];
}

/**
 * When a file whose archive gives no time was last written: the stamp the
 * FAT16 volume gives everything it makes, 10:20:40 on 6 January 2020.
 */
const STAMP = Date.UTC(2020, 0, 6, 10, 20, 40) / 1000;

/** A layer of a stack as the page plans it, and the order its files were placed in, where kept. */
export interface PlannedLayer {
  layer: Layer;

  /**
   * The paths of its files in the order they are put on the drive: a
   * program's archive's, in the archive's order, as a drive of the archive
   * dropped loose has them (`programLayer`). Files it does not name go
   * after, in the layer's order; without it, all are in the layer's.
   */
  order?: string[];
}

/**
 * A stack over the base the page places (`kb/formats/layer.md`): the
 * base's name, `base:<assets id>:<display>` or `install:<sha256>`, and its
 * layers, the lowest first.
 */
export interface Stack {
  base: string;
  layers: PlannedLayer[];
}

/**
 * Where everything dropped goes on C:, and under which 8.3 names: the Windows
 * installation, if given, under `C:\WINDOWS`, or else the asset bundle's base
 * for the display, if given, where Setup put each of its files; then the
 * layers of a stack over that base, each put on what is beneath as
 * `flattenStack` puts it (`kb/formats/layer.md`); and each archive under a
 * directory of its own. Both engines fill their drives from this, so a
 * program sees the same names on either.
 */
export function planDrive(
  archives: Archive[],
  windows: Archive | null,
  base: Composed | null = null,
  stack?: Stack
): Plan {
  const plan: Plan = {
    folders: [],
    placements: [],
    stamps: [],
    files: [],
    programs: [],
    windows: false,
    renamed: [],
  };

  /* The names used so far in each directory, by its DOS path. */
  const used = new Map<string, Set<string>>();

  const place = (parts: string[], entry: ZipEntry, original: string) => {
    const dos: string[] = [];

    for (const part of parts) {
      const key = dos.join('\\');
      const taken = used.get(key) ?? new Set<string>();

      used.set(key, taken);

      /* A directory already named keeps its name for every file beneath it. */
      const existing = [...taken].find((name) => name === part.toUpperCase());
      const name = existing && dos.length < parts.length - 1 ? existing : shortName(part, taken);

      dos.push(name);
    }

    if (dos.join('\\').toUpperCase() !== parts.join('\\').toUpperCase()) {
      plan.renamed.push({ from: original, to: `C:\\${dos.join('\\')}` });
    }

    plan.placements.push({
      parts: dos,
      data: entry.data,
      original,
      modified: entry.modified ?? STAMP,
    });
  };

  if (windows) {
    const root = windowsRoot(windows.entries);

    if (root !== null) {
      plan.windows = true;

      for (const entry of windows.entries) {
        if (entry.path.startsWith(root)) {
          const rest = entry.path.slice(root.length).split('/').filter(Boolean);

          place(['WINDOWS', ...rest], entry, entry.path);
        }
      }
    }
  } else if (base) {
    /* The base's folders made first, at the page's stamp, as the harnesses
     * and the native build make them; then its files, under the names Setup
     * gave them, which are 8.3 names already. */
    plan.windows = true;

    for (const folder of base.directories) {
      const parts = folder.split('/');

      plan.folders.push({ parts, modified: STAMP });

      for (let at = 0; at < parts.length; at++) {
        const key = parts.slice(0, at).join('\\');
        const taken = used.get(key) ?? new Set<string>();

        taken.add(parts[at]);
        used.set(key, taken);
      }
    }

    for (const file of base.files) {
      place(file.path.split('/'), file, file.path);
    }
  }

  if (stack?.layers.length) {
    putLayers(plan, stack);

    /* Their names taken, for an archive placed loose beside them. */
    for (const path of [
      ...plan.placements.map(({ parts }) => parts),
      ...plan.stamps.map(({ parts }) => parts),
    ]) {
      for (let at = 0; at < path.length; at++) {
        const key = path.slice(0, at).join('\\');
        const taken = used.get(key) ?? new Set<string>();

        taken.add(path[at]);
        used.set(key, taken);
      }
    }
  }

  for (const archive of archives) {
    const base = archive.name.replace(/\.zip$/i, '');

    for (const entry of archive.entries) {
      place(
        [base, ...entry.path.split('/').filter(Boolean)],
        entry,
        `${archive.name}/${entry.path}`
      );
    }
  }

  /* What is on C:, and the programs among it, in the order it is placed. */
  for (const { parts, data } of plan.placements) {
    const path = `C:\\${parts.join('\\')}`;
    const kind = /\.EXE$/.test(path) ? kindOf(data) : null;

    plan.files.push(path);

    if (kind) {
      plan.programs.push({ path, parts, kind });
    }
  }

  return plan;
}

/** Whether a path is a folder's, or beneath it. */
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}\\`);

/** The folders above a path, the shallowest first. */
const above = (path: string) => {
  const names = path.split('\\');

  return names.slice(1).map((_, at) => names.slice(0, at + 1).join('\\'));
};

/** The canonical order of folders: the shallowest first, each depth by path, byte by byte. */
const foldersFirst = (one: string, other: string) =>
  one.split('\\').length - other.split('\\').length || (one < other ? -1 : one > other ? 1 : 0);

const pathOf = ({ parts }: { parts: string[] }) => parts.join('\\');

/**
 * A stack's layers put on the plan of its base, in their order, each entry
 * as `flattenStack` puts it on what is beneath (`kb/formats/layer.md`): a
 * removed path's files and folders taken out of the plan; a folder made,
 * the folders above it too, or its stamp moved; a file placed, replacing
 * one there, after what is placed already, as a drive made afresh takes
 * it, and the folders above it made with its stamp where they are not
 * there. What the layers make or stamp of folders goes in `stamps`, set
 * once the files are placed. Refused as a stack is refused
 * (`stackRefusal`), the base counted as a layer.
 */
function putLayers(plan: Plan, { base, layers }: Stack) {
  const refusal = stackRefusal([
    planManifest(plan, base),
    ...layers.map(({ layer }) => layer.manifest),
  ]);

  if (refusal) {
    throw new Error(refusal);
  }

  /* Every folder there is, and the stamps the layers give folders. */
  const folders = new Set<string>();
  const stamps = new Map<string, number>();

  for (const folder of plan.folders) {
    for (const path of [...above(pathOf(folder)), pathOf(folder)]) {
      folders.add(path);
    }
  }

  for (const placement of plan.placements) {
    for (const path of above(pathOf(placement))) {
      folders.add(path);
    }
  }

  const files = new Set(plan.placements.map(pathOf));

  /* A folder made where it is not there, with the folders above it,
   * stamped then; false where a file is in the way. */
  const made = (path: string, modified: number) => {
    for (const folder of [...above(path), path]) {
      if (files.has(folder)) {
        return false;
      }

      if (!folders.has(folder)) {
        folders.add(folder);
        stamps.set(folder, modified);
      }
    }

    return true;
  };

  for (const { layer, order } of layers) {
    const placed = new Map((order ?? []).map((path, at) => [path, at]));
    const rank = (entry: LayerEntry) => placed.get(entry.path) ?? placed.size;
    const entries = layer.manifest.entries
      .map((entry, at) => ({ entry, at }))
      .sort(
        (one, other) =>
          (one.entry.kind === 'file' && other.entry.kind === 'file'
            ? rank(one.entry) - rank(other.entry)
            : 0) || one.at - other.at
      )
      .map(({ entry }) => entry);

    for (const entry of entries) {
      switch (entry.kind) {
        case 'removed':
          plan.placements = plan.placements.filter((one) => !within(pathOf(one), entry.path));
          plan.folders = plan.folders.filter((one) => !within(pathOf(one), entry.path));

          for (const path of [...folders, ...files]) {
            if (within(path, entry.path)) {
              folders.delete(path);
              files.delete(path);
              stamps.delete(path);
            }
          }

          break;
        case 'folder':
          if (made(entry.path, entry.modified)) {
            stamps.set(entry.path, entry.modified);
          }

          break;
        case 'file': {
          const folder = above(entry.path).pop();

          if (folders.has(entry.path) || (folder && !made(folder, entry.modified))) {
            break;
          }

          const data = layer.blobs.get(entry.sha256);

          if (!data) {
            throw new Error(`layer ${layer.manifest.id} has no blob ${entry.sha256}`);
          }

          plan.placements = plan.placements.filter((one) => pathOf(one) !== entry.path);
          plan.placements.push({
            parts: entry.path.split('\\'),
            data,
            original: `${layer.manifest.id}/${entry.path}`,
            modified: entry.modified,
          });
          files.add(entry.path);
          break;
        }
      }
    }
  }

  plan.stamps = [...stamps.keys()]
    .sort(foldersFirst)
    .map((path) => ({ parts: path.split('\\'), modified: stamps.get(path)! }));
}

/**
 * What a plan puts on C:, as a layer's manifest, for telling whether a
 * layer touches it (`stackRefusal`): its folders and its files, by path.
 * Not a layer of its own: its files' hashes are not taken.
 */
export function planManifest(plan: Plan, id: string): LayerManifest {
  const folders = new Set<string>();

  for (const { parts } of [...plan.folders, ...plan.stamps]) {
    folders.add(parts.join('\\'));
  }

  for (const placement of plan.placements) {
    for (const path of above(pathOf(placement))) {
      folders.add(path);
    }
  }

  return {
    format: LAYER_FORMAT,
    id,
    over: [],
    made: { by: 'WinBox' },
    entries: [
      ...[...folders].map((path): LayerEntry => ({ kind: 'folder', path, modified: STAMP })),
      ...plan.placements.map((placement): LayerEntry => ({
        kind: 'file',
        path: pathOf(placement),
        sha256: '',
        size: placement.data.length,
        modified: placement.modified,
      })),
    ],
  };
}

/**
 * The Windows programs a layer writes, as the plan names a program:
 * `C:\WINDOWS\GAMES\CARRIB.EXE`, in the layer's order -- what a program
 * installed into a layer offers to run.
 */
export function layerPrograms(layer: Layer) {
  return layer.manifest.entries.flatMap((entry) => {
    const data = entry.kind === 'file' ? layer.blobs.get(entry.sha256) : undefined;

    return data && /\.EXE$/.test(entry.path) && kindOf(data) === 'windows'
      ? [`C:\\${entry.path}`]
      : [];
  });
}

/** A program's archive made into a layer, and what the page keeps of it beside. */
export interface ProgramLayer {
  layer: Layer;

  /** Its files' paths in the archive's order, which the drive is filled in (`PlannedLayer`). */
  order: string[];

  /** Its programs, as the plan names them: `C:\GAMES\SKI.EXE`. */
  programs: string[];
}

/**
 * A program's archive, dropped, as a layer of its own made over nothing
 * (`kb/formats/layer.md`): each of its files where `planDrive` places it
 * over the base, under the same 8.3 names, written when the archive says;
 * and each folder it makes, `C:\GAMES` and those beneath, at the page's
 * stamp, as the TypeScript engine's volume makes a folder for a file put in
 * it. The stack of the base and this layer is the drive with the archive
 * dropped loose on it, file for file and stamp for stamp. Refused where it
 * would replace a file of the base's.
 */
export async function programLayer(
  archive: Archive,
  windows: Archive | null,
  base: Composed | null
): Promise<ProgramLayer> {
  const beneath = planDrive([], windows, base);
  const loose = planDrive([archive], windows, base);
  const prefix = `${archive.name}/`;
  const placements = loose.placements.filter((one) => one.original.startsWith(prefix));
  const taken = new Set(beneath.placements.map(pathOf));
  const folders = new Set<string>(beneath.folders.map(pathOf));

  for (const placement of beneath.placements) {
    for (const path of above(pathOf(placement))) {
      folders.add(path);
    }
  }

  const made = new Set<string>();
  const changes: Change[] = [];

  for (const placement of placements) {
    const path = pathOf(placement);

    if (taken.has(path)) {
      throw new Error(`it holds C:\\${path}, which Windows has already`);
    }

    for (const folder of above(path)) {
      if (!folders.has(folder)) {
        made.add(folder);
      }
    }

    changes.push({ kind: 'file', path, data: placement.data, modified: placement.modified });
  }

  for (const path of made) {
    changes.push({ kind: 'folder', path, modified: STAMP });
  }

  const layer = await layerFromChanges(changes, {
    made: { by: 'WinBox run page', from: archive.name },
  });
  const order = placements.map(pathOf);

  return {
    layer,
    order,
    programs: loose.programs
      .filter((program) => order.includes(program.parts.join('\\')))
      .map((program) => program.path),
  };
}

/**
 * Formats the machine's first disk and fills it as the plan places
 * everything, each file written when its archive says, as the Rust engine
 * fills its drive: the TypeScript engine's C: drive.
 */
export async function fillDrive(machine: any, { placements, ...plan }: Plan): Promise<Drive> {
  const fileSystem: any = new FAT16(machine.disks[0]);
  await fileSystem.format();

  /* Made as the volume makes a folder, at its own stamp: the page's. */
  for (const { parts } of plan.folders) {
    await fileSystem.open(parts, true);
  }

  /* Each with its archive bit, as DOSBox lists every file of the host's
   * folder its C: is, and the Rust engine's drive lists a file. */
  for (const { parts, data, modified } of placements) {
    await fileSystem.map(parts, new DataView(data.buffer, data.byteOffset, data.byteLength), {
      modified,
      archive: true,
    });
  }

  /* What a stack's layers make or stamp of folders, once its files are
   * there, as a change to a folder is put back on a drive. */
  const changed = fat16Drive(fileSystem);

  for (const { parts, modified } of plan.stamps) {
    await changed.folder(parts.join('\\'), modified);
  }

  return { fileSystem, ...plan };
}

/** The machine's first disk formatted and filled with what was dropped. */
export const buildDrive = (
  machine: any,
  archives: Archive[],
  windows: Archive | null,
  base: Composed | null = null
) => fillDrive(machine, planDrive(archives, windows, base));
