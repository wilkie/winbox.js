'use strict';

import { FAT16 } from '../file-systems/fat16.js';
import { type ZipEntry } from '../zip.js';

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
 * where the system looks for its fonts. Every other archive gets a directory of
 * its own, named after it.
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

/** What goes on C:, worked out once and filled in by whichever engine runs. */
export interface Plan {
  placements: Placement[];
  files: string[];
  programs: Program[];

  /** Whether a Windows installation was found and placed. */
  windows: boolean;

  /** Names that were not valid 8.3 names, and what they became. */
  renamed: { from: string; to: string }[];
}

/**
 * When a file whose archive gives no time was last written: the stamp the
 * FAT16 volume gives everything it makes, 10:20:40 on 6 January 2020.
 */
const STAMP = Date.UTC(2020, 0, 6, 10, 20, 40) / 1000;

/**
 * Where everything dropped goes on C:, and under which 8.3 names: the Windows
 * installation, if given, under `C:\WINDOWS`, and each archive under a
 * directory of its own. Both engines fill their drives from this, so a program
 * sees the same names on either.
 */
export function planDrive(archives: Archive[], windows: Archive | null): Plan {
  const plan: Plan = { placements: [], files: [], programs: [], windows: false, renamed: [] };

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

    const path = `C:\\${dos.join('\\')}`;
    plan.files.push(path);

    const kind = /\.EXE$/.test(path) ? kindOf(entry.data) : null;

    if (kind) {
      plan.programs.push({ path, parts: dos, kind });
    }
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

  return plan;
}

/**
 * Formats the machine's first disk and fills it as the plan places
 * everything, each file written when its archive says, as the Rust engine
 * fills its drive: the TypeScript engine's C: drive.
 */
export async function fillDrive(machine: any, { placements, ...plan }: Plan): Promise<Drive> {
  const fileSystem: any = new FAT16(machine.disks[0]);
  await fileSystem.format();

  for (const { parts, data, modified } of placements) {
    await fileSystem.map(parts, new DataView(data.buffer, data.byteOffset, data.byteLength), {
      modified,
    });
  }

  return { fileSystem, ...plan };
}

/** The machine's first disk formatted and filled with what was dropped. */
export const buildDrive = (machine: any, archives: Archive[], windows: Archive | null) =>
  fillDrive(machine, planDrive(archives, windows));
