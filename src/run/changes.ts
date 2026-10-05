'use strict';

import { modifiedOf, stampOf } from '../file-systems/fat16.js';
import { type Plan } from './drive.js';

/**
 * What programs write on C:, kept: the drive's changes against the drive as
 * the page planned it from what was dropped (`planDrive`). Each engine tells
 * its own -- the TypeScript engine's FAT16 volume here (`Fat16Changes`), the
 * Rust engine's drive held in memory in `crates/winbox-machine`
 * (`MemoryDrive::changes_from`) -- in the same form and the same order, and
 * each puts them back the same way on a drive made afresh (`applyChanges`),
 * so a program sees the same disk on either.
 */

/**
 * A change on C:, its path DOS's beneath the root, upper case:
 * `WINDOWS\WIN.INI`. A file made or written, as it stands; a folder made, or
 * written since; or what was there and is not, a folder with everything in
 * it. When a folder or a file was last written is in seconds since 1970,
 * read as DOS keeps local time, as the plan has a file's.
 */
export type Change =
  | { kind: 'file'; path: string; data: Uint8Array; modified: number }
  | { kind: 'folder'; path: string; modified: number }
  | { kind: 'removed'; path: string };

/** A drive changes are put back on, as each engine's is. */
export interface ChangedDrive {
  remove(path: string): unknown;
  folder(path: string, modified: number): unknown;
  file(path: string, data: Uint8Array, modified: number): unknown;
}

/**
 * Changes in the order they are put back on a drive made afresh from the
 * plan they were told against: what is gone first, then the folders, each
 * before what is in it, then the files -- the order both engines tell them
 * in, kept here too, so that changes from anywhere are put back the same.
 */
export function orderChanges(changes: Change[]) {
  const rank = { removed: 0, folder: 1, file: 2 };

  return changes
    .map((change, index) => ({ change, index }))
    .sort(
      (one, other) =>
        rank[one.change.kind] - rank[other.change.kind] ||
        (one.change.kind === 'folder' ? depth(one.change.path) - depth(other.change.path) : 0) ||
        one.index - other.index
    )
    .map(({ change }) => change);
}

/** Changes put back on a drive made afresh, in their order (`orderChanges`). */
export async function applyChanges(changes: Change[], drive: ChangedDrive) {
  for (const change of orderChanges(changes)) {
    switch (change.kind) {
      case 'removed':
        await drive.remove(change.path);
        break;
      case 'folder':
        await drive.folder(change.path, change.modified);
        break;
      case 'file':
        await drive.file(change.path, change.data, change.modified);
        break;
    }
  }
}

const depth = (path: string) => path.split('\\').length;

/** Whether two sets of changes are the same, bytes and all. */
export function sameChanges(one: Change[], other: Change[]) {
  return (
    one.length === other.length &&
    one.every((change, index) => {
      const that = other[index];

      if (change.kind !== that.kind || change.path !== that.path) {
        return false;
      }

      if (change.kind === 'removed' || that.kind === 'removed') {
        return true;
      }

      if (change.modified !== that.modified) {
        return false;
      }

      return change.kind !== 'file' || that.kind !== 'file' || sameBytes(change.data, that.data);
    })
  );
}

function sameBytes(one: Uint8Array, other: Uint8Array) {
  if (one.length !== other.length) {
    return false;
  }

  for (let at = 0; at < one.length; at++) {
    if (one[at] !== other[at]) {
      return false;
    }
  }

  return true;
}

/* ---- the TypeScript engine's FAT16 volume ---- */

/** An entry of a directory, as `FAT16Directory.list` reads it. */
interface Listed {
  info: any;
  list?: () => Promise<Listed[]>;
}

/** What a directory entry said, when the drive was marked as planned. */
interface Marked {
  directory: boolean;
  inode: number;
  size: number;
  modified: number;
}

/** The end of a cluster chain, and the clusters that are not there. */
const LAST = 0xfff7;

/**
 * The changes on a FAT16 volume, the TypeScript engine's C: drive, against
 * the drive as it was filled from the plan. Marked once it is filled
 * (`mark`), before the changes kept are put back: what each entry said is
 * kept, and the disk notes from then on which sectors are written
 * (`Disk.track`). A file is changed where its entry is not as it was -- made,
 * moved, grown, cut -- or a cluster of it has been written since; and where
 * its bytes are then not what the plan put there. A file being written is
 * read as it stands: the size its entry has, the clusters its chain has.
 */
export class Fat16Changes {
  readonly #fileSystem: any;

  /** The plan's bytes for each file, by its path. */
  readonly #planned = new Map<string, Uint8Array>();

  /** Every entry as the drive was marked, by its path. */
  #marked = new Map<string, Marked>();

  constructor(fileSystem: any, plan: Plan) {
    this.#fileSystem = fileSystem;

    for (const placement of plan.placements) {
      this.#planned.set(placement.parts.join('\\').toUpperCase(), placement.data);
    }
  }

  /** The drive as it is now kept as planned, and its writes noted from now on. */
  async mark() {
    this.#marked = new Map();

    for (const { path, info } of await this.#walk()) {
      this.#marked.set(path, {
        directory: info.directory,
        inode: info.inode,
        size: info.size,
        modified: modifiedOf(info),
      });
    }

    this.#fileSystem.disk.track();
  }

  /** What differs on the drive from the drive as marked, in the order they are put back. */
  async changes(): Promise<Change[]> {
    const now = await this.#walk();
    const here = new Map(now.map(({ path, info }) => [path, info]));
    const removed: Change[] = [];
    const folders: Change[] = [];
    const files: Change[] = [];

    /* What is gone, or is a folder where a file was, or a file where a
     * folder was: the first of it, its folder telling for what is in it. */
    for (const [path, marked] of this.#marked) {
      const info = here.get(path);

      if (!info || info.directory !== marked.directory) {
        if (!removed.some((change) => path.startsWith(`${change.path}\\`))) {
          removed.push({ kind: 'removed', path });
        }
      }
    }

    for (const { path, info } of now) {
      const marked = this.#marked.get(path);
      const modified = modifiedOf(info);
      const same = marked && marked.directory === info.directory;

      if (info.directory) {
        if (!same || marked.modified !== modified) {
          folders.push({ kind: 'folder', path, modified });
        }

        continue;
      }

      if (
        same &&
        marked.inode === info.inode &&
        marked.size === info.size &&
        marked.modified === modified &&
        !(await this.#written(info))
      ) {
        continue;
      }

      const data = await this.#read(info);
      const planned = this.#planned.get(path);

      /* Written back as the plan had it, it is not changed, as on the Rust
       * engine's drive. */
      if (!planned || !sameBytes(planned, data)) {
        files.push({ kind: 'file', path, data, modified });
      }
    }

    return [...removed, ...folders, ...files];
  }

  /**
   * Every file and folder on the drive, a folder before what is in it, by
   * its path, upper case; each folder's in the order of their names, as the
   * Rust engine's drive keeps them, so both tell their changes in one order.
   */
  async #walk() {
    const found: { path: string; info: any }[] = [];
    const byName = (one: Listed, other: Listed) => {
      const [a, b] = [one.info.name.toUpperCase(), other.info.name.toUpperCase()];

      return a < b ? -1 : a > b ? 1 : 0;
    };
    const visit = async (directory: Listed, prefix: string) => {
      for (const item of (await directory.list!()).sort(byName)) {
        const { info } = item;

        if (info.name === '.' || info.name === '..' || info.volume) {
          continue;
        }

        const path = prefix ? `${prefix}\\${info.name.toUpperCase()}` : info.name.toUpperCase();

        found.push({ path, info });

        if (info.directory) {
          await visit(item, path);
        }
      }
    };

    await visit(await this.#fileSystem.open([]), '');
    return found;
  }

  /** The clusters of a file's chain, as many as its size needs, while there are. */
  async #clusters(info: any) {
    const fileSystem = this.#fileSystem;
    const count = Math.ceil(info.size / fileSystem.clusterSize);
    const clusters: number[] = [];

    for (let inode = info.inode; clusters.length < count && inode >= 2 && inode < LAST;) {
      clusters.push(inode);
      inode = await fileSystem.readFATEntry(inode);
    }

    return clusters;
  }

  /** Whether a cluster of a file has been written since the drive was marked. */
  async #written(info: any) {
    const fileSystem = this.#fileSystem;

    for (const cluster of await this.#clusters(info)) {
      const sector = (cluster - 2) * fileSystem.sectorsPerCluster + fileSystem.firstSector;

      if (fileSystem.disk.written(sector, fileSystem.sectorsPerCluster)) {
        return true;
      }
    }

    return false;
  }

  /** A file's bytes as they stand, read along its chain once. */
  async #read(info: any) {
    const fileSystem = this.#fileSystem;
    const data = new Uint8Array(info.size);
    let at = 0;

    for (const cluster of await this.#clusters(info)) {
      const sector = (cluster - 2) * fileSystem.sectorsPerCluster + fileSystem.firstSector;
      const length = Math.min(fileSystem.clusterSize, info.size - at);

      data.set(await fileSystem.disk.read(sector, 0, length), at);
      at += length;
    }

    return data;
  }
}

/**
 * A FAT16 volume as a drive changes are put back on: each path made, or
 * replaced, or let go of, through the volume's own calls, as DOS's are made.
 */
export function fat16Drive(fileSystem: any): ChangedDrive {
  const split = (path: string) => path.split('\\').filter(Boolean);

  /* A folder emptied and let go of, with everything in it. */
  const removeAll = async (directory: any, name: string) => {
    const found = await directory.lookup(name);

    if (found?.info.directory) {
      for (const item of await found.list()) {
        if (item.info.name !== '.' && item.info.name !== '..') {
          await removeAll(found, item.info.name);
        }
      }
    }

    return fileSystem.unlink(directory, name);
  };

  return {
    async remove(path) {
      const parts = split(path);
      const directory = await fileSystem.open(parts.slice(0, -1));

      if (!directory?.info.directory) {
        return false;
      }

      return removeAll(directory, parts[parts.length - 1]);
    },

    async folder(path, modified) {
      const parts = split(path);
      const parent = await fileSystem.open(parts.slice(0, -1), true);
      const name = parts[parts.length - 1];
      const found = await parent.lookup(name);

      if (found && !found.info.directory) {
        await fileSystem.unlink(parent, name);
      }

      if (!found || !found.info.directory) {
        await fileSystem.makeDirectory(parent, name, modified);
        return;
      }

      /* A folder there already, written when the change says. */
      const { time, date } = stampOf(modified);

      await parent.write16(
        found.info.entryOffset + 22,
        (time.hour << 11) | (time.minute << 5) | (time.second >> 1)
      );
      await parent.write16(
        found.info.entryOffset + 24,
        ((date.year - 1980) << 9) | (date.month << 5) | date.day
      );
    },

    async file(path, data, modified) {
      await fileSystem.map(
        split(path),
        new DataView(data.buffer, data.byteOffset, data.byteLength),
        { modified }
      );
    },
  };
}
