/**
 * Disk and disc images on the page's drives (`kb/topics/drives-and-disks.md`,
 * "The page's drives"): what an image dropped is -- a floppy's FAT, a hard
 * disk's, an ISO 9660 disc -- and whether it is the user's Windows 3.1 media
 * for the asset maker or a drive of its own; floppies dropped together made
 * one set in the order of their names; the letters each set is given, as the
 * owner chose (decision 3) and the native build gives them
 * (`crates/winbox-native/src/mounts.rs`); and the Windows programs on a
 * drive, to be run from it.
 *
 * The image's bytes are read where the page holds them, and never written:
 * what programs write to a FAT image is kept in each engine's copy-on-write
 * overlay (`FATImage`, `FatVolume`), and saved only as a new file (decision
 * 1).
 */

import { FATImage } from '../file-systems/fat-image.js';
import { readFat12 } from '../file-systems/fat12.js';
import { ISO9660 } from '../file-systems/iso9660.js';
import { type Program } from './drive.js';

/** What an image is, as DOSBox's `imgmount -t` and a kept program's media name it. */
export type ImageKind = 'floppy' | 'hdd' | 'iso';

/** A disk of a drive's set: its image, as the page holds it. */
export interface Disk {
  /** Its file's name, as it was dropped or chosen. */
  name: string;

  /** Its file's size and last change, which with its name tell it again on a later visit (`imageKey`). */
  size: number;
  modified: number;

  /**
   * Its bytes: the file's, read where the browser has them; or, once a
   * machine it was in has been made afresh, the image as programs wrote it
   * (`written`), which the next machine is given.
   */
  bytes: Uint8Array;

  /** Whether programs have written to it, so that its bytes are the image as written. */
  written: boolean;
}

/** A drive's images, in order, and which is in it. */
export interface DriveSet {
  /** The drive's letter, upper case: `A`. */
  letter: string;
  kind: ImageKind;
  disks: Disk[];

  /** The disk in the drive, from nought; the one last in where it is empty. */
  current: number;
  ejected: boolean;
}

/** The names images go by: floppies' and hard disks' `.img` and the rest, discs' `.iso`. */
export const IMAGE_NAME = /\.(img|ima|dsk|vfd|iso)$/i;

/** The largest image DOSBox takes for a floppy, in whole KB (`drive_fat.cpp` 645-654). */
const FLOPPY_KB = 2880;

/**
 * What an image is, as DOSBox's `imgmount` would mount it, read with the
 * engine's own readers: an `.iso` a disc; else a FAT volume -- a floppy's
 * where it is 2,880 KB or less, as DOSBox takes one (`is_floppy`), a hard
 * disk's else -- and a disc where it holds no FAT. Null for anything
 * neither reader takes.
 */
export async function imageKind(name: string, bytes: Uint8Array): Promise<ImageKind | null> {
  const disc = () => {
    try {
      ISO9660.of(bytes);
      return 'iso' as const;
    } catch {
      return null;
    }
  };

  if (/\.iso$/i.test(name)) {
    return disc();
  }

  const floppy = Math.floor(bytes.length / 1024) <= FLOPPY_KB;

  try {
    await FATImage.of(bytes, floppy);
    return floppy ? 'floppy' : 'hdd';
  } catch {
    return disc();
  }
}

/**
 * What tells an image's file again on a later visit, without reading it
 * through: its name, size and last change, as the plan has it (not hashed).
 */
export const imageKey = (name: string, size: number, modified: number) =>
  `${name}:${size}:${modified}`;

/**
 * Images in the order of their names, as a set dropped together is put in
 * its drive: numbers counted as numbers, so `DISK2` comes before `DISK10`,
 * and case set aside.
 */
export function orderSet<T extends { name: string }>(images: T[]): T[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  return [...images].sort((one, other) => collator.compare(one.name, other.name));
}

/**
 * The letter each set is given, in the order given: one asked for (a kept
 * program's, pinned) where it is free; else, as the owner chose and the
 * native build gives them (`Mounts::open`), a floppy A: then B:, a hard
 * disk the first free from D:, a disc the first free after the hard
 * disks' letters, those taken and those given here. C: is the page's. An
 * error in place of a letter where none is free.
 */
export function assignLetters(
  sets: { kind: ImageKind; letter?: string | null }[],
  taken: { kind: ImageKind; letter: string }[]
): (string | Error)[] {
  const used = new Set(['C', ...taken.map((set) => set.letter)]);
  const letters: (string | Error | null)[] = sets.map((set) => {
    const asked = set.letter?.toUpperCase() ?? null;

    if (asked && !used.has(asked)) {
      used.add(asked);
      return asked;
    }

    return null;
  });
  const free = (from: string, to: string) => {
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) {
      const letter = String.fromCharCode(code);

      if (!used.has(letter)) {
        return letter;
      }
    }

    return null;
  };
  const disks = () =>
    [
      ...taken.filter((set) => set.kind === 'hdd').map((set) => set.letter),
      ...sets.flatMap((set, at) =>
        set.kind === 'hdd' && typeof letters[at] === 'string' ? [letters[at] as string] : []
      ),
    ].sort();

  for (const kind of ['floppy', 'hdd', 'iso'] as const) {
    sets.forEach((set, at) => {
      if (letters[at] !== null || set.kind !== kind) {
        return;
      }

      const after = disks().at(-1);
      const letter =
        kind === 'floppy'
          ? free('A', 'B')
          : kind === 'hdd'
            ? free('D', 'Z')
            : free(after ? String.fromCharCode(after.charCodeAt(0) + 1) : 'D', 'Z');

      if (letter) {
        used.add(letter);
      }

      letters[at] =
        letter ??
        new Error(
          kind === 'floppy'
            ? 'A: and B: have floppies in them already'
            : `no drive letter is free for a ${kind === 'hdd' ? 'hard disk' : 'disc'}`
        );
    });
  }

  return letters as (string | Error)[];
}

/** A drive as the Drives strip says it: `Disk 2 of 6, DISK2.IMG`, or empty. */
export function setText(set: DriveSet) {
  const disk = set.disks[set.current];
  const kind = set.kind === 'iso' ? 'Disc' : 'Disk';

  if (set.ejected) {
    return set.disks.length > 1 ? `Empty (${set.disks.length} ${kind.toLowerCase()}s)` : 'Empty';
  }

  return set.disks.length > 1
    ? `${kind} ${set.current + 1} of ${set.disks.length}, ${disk.name}`
    : disk.name;
}

/** The files of the known media, by name and SHA-256, as `known-media.json` lists them. */
export interface KnownFiles {
  media: { files: { name: string; size: number; sha256: string }[] }[];
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether a floppy's image is one of the Windows 3.1 media WinBox knows: a
 * file on it of the name, size and SHA-256 `known-media.json` lists. Only
 * files of a known name and size are hashed.
 */
export async function isKnownMedia(bytes: Uint8Array, known: KnownFiles) {
  const listed = new Map<string, Set<string>>();

  for (const file of known.media.flatMap((medium) => medium.files)) {
    const key = `${file.name.toUpperCase()}:${file.size}`;

    listed.set(key, (listed.get(key) ?? new Set()).add(file.sha256));
  }

  let files;

  try {
    files = readFat12(bytes);
  } catch {
    return false;
  }

  for (const file of files) {
    const name = file.path.split('/').pop()!.toUpperCase();
    const hashes = listed.get(`${name}:${file.data.length}`);

    if (hashes?.has(await sha256(file.data))) {
      return true;
    }
  }

  return false;
}

/** An image's volume as the TypeScript engine reads one, for the page to look over. */
export async function volumeOf(kind: ImageKind, bytes: Uint8Array): Promise<any> {
  return kind === 'iso' ? ISO9660.of(bytes) : FATImage.of(bytes, kind === 'floppy');
}

/** Bytes of a file opened on a volume. */
async function bytesOf(file: any, offset: number, length: number) {
  return new Uint8Array(await file.read(offset, length));
}

/** Whether a file opened on a volume is a Windows program: an MZ stub pointing at an NE header. */
async function isWindowsProgram(file: any) {
  const size = file.info?.size ?? file.size ?? 0;

  if (size < 0x40) {
    return false;
  }

  const stub = await bytesOf(file, 0, 0x40);

  if (stub[0] !== 0x4d || stub[1] !== 0x5a) {
    return false;
  }

  const header = stub[0x3c] | (stub[0x3d] << 8) | (stub[0x3e] << 16) | (stub[0x3f] << 24);

  if (header <= 0 || header + 1 >= size) {
    return false;
  }

  const signature = await bytesOf(file, header, 2);

  return signature[0] === 0x4e && signature[1] === 0x45;
}

/**
 * The programs on a drive's disk, as DOS names them -- `A:\SETUP.EXE` --
 * in the order its folders hold them, folders walked to a depth of four:
 * Windows programs to be run, others listed as DOS ones.
 */
export async function programsOn(volume: any, letter: string): Promise<Program[]> {
  const programs: Program[] = [];

  const walk = async (parts: string[]) => {
    const folder = await volume.open(parts);
    const entries: any[] = (await folder?.list?.()) ?? [];

    for (const entry of entries) {
      const name: string = entry.info?.name ?? '';

      if (name === '.' || name === '..' || !name) {
        continue;
      }

      if (entry.info.directory) {
        if (parts.length < 3) {
          await walk([...parts, name]);
        }

        continue;
      }

      if (!/\.EXE$/i.test(name)) {
        continue;
      }

      const file = await volume.open([...parts, name]);
      const windows = file ? await isWindowsProgram(file).catch(() => false) : false;

      programs.push({
        path: `${letter}:\\${[...parts, name].join('\\')}`,
        parts: [...parts, name],
        kind: windows ? 'windows' : 'dos',
      });
    }
  };

  await walk([]);
  return programs;
}

/**
 * A program's installer on a drive: `SETUP.EXE` or `INSTALL.EXE`, the
 * shallowest, the first of its depth in the disk's order, a Windows
 * program; none where there is none.
 */
export function installerOn(programs: Program[]) {
  return (
    programs
      .filter(
        (program) =>
          program.kind === 'windows' && /^(SETUP|INSTALL)\.EXE$/i.test(program.parts.at(-1) ?? '')
      )
      .map((program, at) => ({ program, at }))
      .sort(
        (one, other) => one.program.parts.length - other.program.parts.length || one.at - other.at
      )[0]?.program ?? null
  );
}
