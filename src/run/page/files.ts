/**
 * The files on the page's drives, as its file browser lists them: each
 * folder's entries as DOS lists them -- 8.3 names, upper case, a file's size
 * and the stamp its directory entry holds -- sorted as asked, and marked
 * where programs changed them. No React here, nor the DOM: these are tested
 * from jest (`test/run/page_files_test.ts`); `browse.ts` reads the drives
 * through them.
 *
 * C: is read from what the page has of it: the plan the engine fills it from
 * (`Plan`: its folders, its files, the folders a stack stamps) and the
 * changes the engine tells against it (`Engine.changes`), each folder or
 * file as the engine puts it there.
 * A drive of images is read from its disk's image, as programs have
 * written it, with the page's own readers (`volumeOf`).
 */

import { type Change } from '../changes.js';
import { type Plan } from '../drive.js';
import { modifiedOf, stampOf } from '../../file-systems/fat16.js';

/** A folder's entry, as the file browser lists it. */
export interface FileEntry {
  /** Its 8.3 name, upper case, as DOS lists it: `SOL.EXE`. */
  name: string;
  folder: boolean;

  /** Its size in bytes; nought for a folder. */
  size: number;

  /** When it was last written, in seconds since 1970 read as DOS keeps local time, to DOS's two seconds. */
  modified: number;

  /**
   * Where programs changed it: `changed` written since C: was last made,
   * or since the drive's disk was put in; `kept` a change of before, kept
   * in this browser and put back. None for a file as it was planned.
   */
  mark: 'changed' | 'kept' | null;

  /** The name it was dropped with, where that was no 8.3 name: `Long File Name.txt`. */
  was?: string;
}

/** The columns a folder is sorted by. */
export type SortKey = 'name' | 'size' | 'modified';

/** How a folder is sorted: by a column, one way or the other. */
export interface Sorting {
  key: SortKey;
  ascending: boolean;
}

/**
 * A folder's entries sorted: folders before files, as File Manager lists
 * them, each by the column chosen, then by name; names as DOS compares
 * them, by their characters' codes, upper case as they are.
 */
export function sortEntries(entries: FileEntry[], { key, ascending }: Sorting): FileEntry[] {
  const byName = (one: FileEntry, other: FileEntry) =>
    one.name < other.name ? -1 : one.name > other.name ? 1 : 0;
  const by = (one: FileEntry, other: FileEntry) =>
    key === 'name'
      ? byName(one, other)
      : key === 'size'
        ? one.size - other.size
        : one.modified - other.modified;

  return [...entries].sort(
    (one, other) =>
      Number(other.folder) - Number(one.folder) ||
      (ascending ? 1 : -1) * by(one, other) ||
      byName(one, other)
  );
}

/** A date and time as DOS's `DIR` shows them: `03-10-92   3:10a`, the hour without a nought before it. */
export function dosDate(modified: number) {
  const at = new Date(modified * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  const hour = at.getUTCHours();

  return (
    `${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}-${two(at.getUTCFullYear() % 100)} ` +
    `${String(hour % 12 || 12).padStart(2, ' ')}:${two(at.getUTCMinutes())}${hour < 12 ? 'a' : 'p'}`
  );
}

/** A size as DOS's `DIR` shows it: a file's bytes, a folder `<DIR>`. */
export const dosSize = (entry: Pick<FileEntry, 'folder' | 'size'>) =>
  entry.folder ? '<DIR>' : String(entry.size);

/** A folder's path as DOS writes it: `C:\`, `C:\WINDOWS\SYSTEM`. */
export const pathText = (letter: string, parts: string[]) => `${letter}:\\${parts.join('\\')}`;

/** A path as DOS writes it taken apart: its drive's letter, upper case, and its names. */
export function pathParts(path: string): { letter: string; parts: string[] } {
  const [, letter = 'C', rest = ''] = /^([A-Za-z]):\\?(.*)$/.exec(path) ?? [];

  return {
    letter: letter.toUpperCase(),
    parts: rest
      .split('\\')
      .filter(Boolean)
      .map((part) => part.toUpperCase()),
  };
}

/** A stamp as a directory entry holds it: to DOS's two seconds, from 1980; the volume's own where none is given. */
export function dosStamp(modified?: number) {
  const { time, date } = stampOf(modified);

  /* An entry holds its seconds halved (`DOS_PackTime`). */
  return modifiedOf({ time: { ...time, second: time.second & ~1 }, date });
}

/** Whether a file's first bytes are a Windows program's: an MZ stub pointing at an NE header. */
export function isWindowsProgram(bytes: Uint8Array) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return false;
  }

  const header = bytes[0x3c] | (bytes[0x3d] << 8) | (bytes[0x3e] << 16) | (bytes[0x3f] << 24);

  return (
    header > 0 && header + 1 < bytes.length && bytes[header] === 0x4e && bytes[header + 1] === 0x45
  );
}

/* ---- C: ---- */

/** A folder or a file of C:, as the plan and the changes make it. */
export interface Node {
  entry: FileEntry;

  /** A file's bytes. */
  data?: Uint8Array;

  /** A folder's entries, by name. */
  children?: Map<string, Node>;
}

/** Whether two changes are the same change: the same kind, stamp and bytes. */
function same(one: Change, other: Change | undefined) {
  if (!other || one.kind !== other.kind) {
    return false;
  }

  if (one.kind === 'removed' || other.kind === 'removed') {
    return true;
  }

  if (one.modified !== other.modified) {
    return false;
  }

  if (one.kind === 'file' && other.kind === 'file') {
    return (
      one.data.length === other.data.length && one.data.every((byte, at) => byte === other.data[at])
    );
  }

  return true;
}

/**
 * C: as a tree: the plan's folders and files, then the changes told
 * against it, in their order -- what is gone taken away, folders made or
 * stamped, files written -- each change marked `kept` where it is the
 * change put back as C: was made (`given`), `changed` where it is not.
 * Folders made on the way to a file take the stamp the volume gives what
 * it makes, as the engine's drive does.
 */
export function driveTree(
  plan: Pick<Plan, 'folders' | 'placements' | 'stamps' | 'renamed'>,
  changes: Change[],
  given: Change[] = []
): Node {
  const root: Node = {
    entry: { name: '', folder: true, size: 0, modified: dosStamp(), mark: null },
    children: new Map(),
  };
  const was = new Map(plan.renamed.map((one) => [one.to, one.from.split('/').pop()!]));
  const folderAt = (parts: string[], modified?: number) => {
    let node = root;

    for (const name of parts) {
      let next = node.children!.get(name);

      if (!next?.children) {
        next = {
          entry: { name, folder: true, size: 0, modified: dosStamp(), mark: null },
          children: new Map(),
        };
        node.children!.set(name, next);
      }

      node = next;
    }

    if (modified !== undefined) {
      node.entry.modified = dosStamp(modified);
    }

    return node;
  };
  const put = (parts: string[], data: Uint8Array, modified: number, mark: FileEntry['mark']) => {
    const name = parts.at(-1)!;
    const renamed = was.get(`C:\\${parts.join('\\')}`);

    folderAt(parts.slice(0, -1)).children!.set(name, {
      entry: {
        name,
        folder: false,
        size: data.length,
        modified: dosStamp(modified),
        mark,
        ...(renamed && renamed.toUpperCase() !== name ? { was: renamed } : {}),
      },
      data,
    });
  };
  const givenAt = new Map(given.map((change) => [change.path, change]));

  for (const folder of plan.folders) {
    folderAt(folder.parts, folder.modified);
  }

  for (const placement of plan.placements) {
    put(placement.parts, placement.data, placement.modified, null);
  }

  for (const stamp of plan.stamps) {
    folderAt(stamp.parts, stamp.modified);
  }

  for (const change of changes) {
    const parts = change.path.split('\\');
    const mark = same(change, givenAt.get(change.path)) ? 'kept' : 'changed';

    switch (change.kind) {
      case 'removed':
        folderAt(parts.slice(0, -1)).children!.delete(parts.at(-1)!);
        break;
      case 'folder':
        folderAt(parts, change.modified).entry.mark = mark;
        break;
      case 'file':
        put(parts, change.data, change.modified, mark);
        break;
    }
  }

  return root;
}

/** A folder of a tree by its names; null where there is none. */
export function nodeAt(root: Node, parts: string[]): Node | null {
  let node: Node | undefined = root;

  for (const name of parts) {
    node = node.children?.get(name.toUpperCase());

    if (!node) {
      return null;
    }
  }

  return node;
}

/* ---- a drive of images ---- */

/** A directory entry as the page's readers list one (`slotEntry`, `DirEntry.findInfo`). */
export interface ListedInfo {
  name: string;
  directory?: boolean;
  volume?: boolean;
  size?: number;
  time: { hour: number; minute: number; second: number };
  date: { year: number; month: number; day: number };
}

/**
 * A folder's entries as a volume lists them, `.` and `..` and the volume's
 * label passed over, each marked `changed` where `before` -- the same
 * folder of the disk as it was put in -- has no entry of its name, size
 * and stamp; none marked where there is no before.
 */
export function volumeEntries(listed: ListedInfo[], before: ListedInfo[] | null): FileEntry[] {
  const key = (info: ListedInfo) =>
    `${info.name}\n${info.directory ? 'dir' : (info.size ?? 0)}\n${modifiedOf(info)}`;
  const had = before ? new Set(before.filter((info) => !info.volume).map(key)) : null;

  return listed
    .filter((info) => info.name && info.name !== '.' && info.name !== '..' && !info.volume)
    .map((info) => ({
      name: info.name.toUpperCase(),
      folder: Boolean(info.directory),
      size: info.directory ? 0 : (info.size ?? 0),
      modified: modifiedOf(info),
      mark: had && !had.has(key(info)) ? 'changed' : null,
    }));
}
