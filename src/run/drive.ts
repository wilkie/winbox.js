'use strict';

import { FAT16 } from '../file-systems/fat16.js';
import { type ZipEntry } from '../zip.js';

/**
 * Puts dropped archives onto the machine's C: drive, a FAT16 volume made in
 * memory -- the same file system the tests and the oracle's drive image use,
 * so a program sees 8.3 names and a real directory structure.
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

/**
 * Formats the machine's first disk and fills it: the Windows installation, if
 * given, under `C:\WINDOWS`, and each archive under a directory of its own.
 */
export async function buildDrive(machine: any, archives: Archive[], windows: Archive | null) {
  const fileSystem: any = new FAT16(machine.disks[0]);
  await fileSystem.format();

  const drive: Drive = { fileSystem, files: [], programs: [], windows: false, renamed: [] };

  /* The names used so far in each directory, by its DOS path. */
  const used = new Map<string, Set<string>>();

  const place = async (parts: string[], data: Uint8Array, original: string) => {
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
      drive.renamed.push({ from: original, to: `C:\\${dos.join('\\')}` });
    }

    await fileSystem.map(dos, new DataView(data.buffer, data.byteOffset, data.byteLength));

    const path = `C:\\${dos.join('\\')}`;
    drive.files.push(path);

    const kind = /\.EXE$/.test(path) ? kindOf(data) : null;

    if (kind) {
      drive.programs.push({ path, parts: dos, kind });
    }
  };

  if (windows) {
    const root = windowsRoot(windows.entries);

    if (root !== null) {
      drive.windows = true;

      for (const entry of windows.entries) {
        if (entry.path.startsWith(root)) {
          const rest = entry.path.slice(root.length).split('/').filter(Boolean);

          await place(['WINDOWS', ...rest], entry.data, entry.path);
        }
      }
    }
  }

  for (const archive of archives) {
    const base = archive.name.replace(/\.zip$/i, '');

    for (const entry of archive.entries) {
      await place(
        [base, ...entry.path.split('/').filter(Boolean)],
        entry.data,
        `${archive.name}/${entry.path}`
      );
    }
  }

  return drive;
}
