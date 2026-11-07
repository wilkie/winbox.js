/**
 * The file browser's reading of the page's drives: which drives there are,
 * a folder's entries, a file's bytes -- downloaded, or run where it is a
 * Windows program -- read from what the page has (`files.ts`): C: from the
 * plan and the engine's changes against it, a drive of images from its
 * disk's image as programs have written it (`Engine.diskImage`), with the
 * page's own readers. Nothing here writes to any drive: the engines' file
 * systems are only asked what they hold.
 *
 * Which folder is being browsed is published (`browsing`), for whichever
 * component shows it -- the side's "Browse files…", a drive's card, a
 * launcher's -- to open it. It browses the drives of the machine shown as
 * it was opened, the dialog over the page while it is open.
 */

import { type Program } from '../drive.js';
import { type DriveSet, volumeOf } from '../drives.js';
import { run } from './machine.js';
import { Observable } from './observable.js';
import {
  driveTree,
  type FileEntry,
  isWindowsProgram,
  type ListedInfo,
  type Node,
  nodeAt,
  pathText,
  volumeEntries,
} from './files.js';
import { current, type Machine, status, statusLine } from './state.js';

/** The folder the file browser shows: its drive's letter and its names; null while it is closed. */
export interface Browsing {
  letter: string;
  parts: string[];

  /** The status line's count as the browser was opened: what is said after is said in it too. */
  since: number;
}

export const browsing = new Observable<Browsing | null>(null);

/** The machine whose drives are browsed: the one shown as the browser was opened. */
let browsed: Machine | null = null;

/** The machine browsed, or the one shown. */
const machineBrowsed = () => (browsed && !browsed.closed ? browsed : current());

/** The file browser opened on a drive's folder, its root by default: what it read before read afresh. */
export function browse(letter = 'C', parts: string[] = []) {
  forget();
  browsed = current();
  browsing.set({
    letter: letter.toUpperCase(),
    parts,
    since: browsing.get()?.since ?? statusLine.get().seq,
  });
}

/** The file browser closed. */
export function stopBrowsing() {
  browsing.set(null);
}

/** A drive the browser offers, and what it is. */
export interface DriveChoice {
  letter: string;
  text: string;
}

/** The drives to browse: C:, then each drive of images, as its card names it. */
export function drivesToBrowse(): DriveChoice[] {
  return [
    { letter: 'C', text: 'C: hard disk' },
    ...(machineBrowsed()?.drives ?? []).map((set) => ({
      letter: set.letter,
      text: `${set.letter}: ${set.kind === 'iso' ? 'CD-ROM drive' : set.kind === 'hdd' ? 'hard disk' : 'floppy drive'}`,
    })),
  ];
}

/* ---- what is read, kept while the browser is open ---- */

/** C:'s tree, as last read. */
let tree: Node | null = null;

/** Each drive's volumes as last read: its disk as written, and as it was put in. */
const volumes = new Map<string, { now: any; before: any | null }>();

/** What was read let go of, so that the next reading is afresh. */
export function forget() {
  tree = null;
  volumes.clear();
}

async function treeNow() {
  const machine = machineBrowsed();
  const plan = machine?.plan;

  if (!plan) {
    return null;
  }

  if (!tree) {
    const told = await machine.made?.changes().catch(() => null);

    /* No machine to ask: what was kept is what is put back on it. */
    tree = driveTree(plan, told ?? machine.given, machine.given);
  }

  return tree;
}

/** A drive's disk read: as programs have written it, and as it was put in where they have. */
async function volumesOf(set: DriveSet) {
  let had = volumes.get(set.letter);

  if (!had) {
    const made = machineBrowsed().made;
    const disk = set.disks[set.current];
    const written =
      set.kind !== 'iso' && made?.diskChanged(set.letter, set.current)
        ? made.diskImage(set.letter, set.current)
        : null;

    had = {
      now: await volumeOf(set.kind, written ? { ...disk, bytes: written } : disk),
      before: written ? await volumeOf(set.kind, disk) : null,
    };
    volumes.set(set.letter, had);
  }

  return had;
}

/** Entries as a volume's folder lists them. */
async function listed(volume: any, parts: string[]): Promise<ListedInfo[] | null> {
  const folder = await volume.open(parts);

  if (!folder?.list) {
    return null;
  }

  return (await folder.list()).map((entry: any) => entry.info);
}

/** A folder's entries, or why there are none. */
export interface Listing {
  entries: FileEntry[];

  /** Why nothing is listed: no Windows, no disk in the drive, no such folder. */
  note: string | null;
}

/** A folder of a drive listed, unsorted. */
export async function listFolder(letter: string, parts: string[]): Promise<Listing> {
  const none = (note: string): Listing => ({ entries: [], note });

  try {
    if (letter === 'C') {
      const root = await treeNow();

      if (!root) {
        return none('C: is being made.');
      }

      const node = nodeAt(root, parts);

      return node?.children
        ? { entries: [...node.children.values()].map((child) => child.entry), note: null }
        : none(`${pathText(letter, parts)} is not there.`);
    }

    const set = machineBrowsed().drives.find((one) => one.letter === letter);

    if (!set) {
      return none(`There is no ${letter}: drive.`);
    }

    if (set.ejected) {
      return none(`${letter}: is empty.`);
    }

    const { now, before } = await volumesOf(set);
    const entries = await listed(now, parts);

    if (!entries) {
      return none(`${pathText(letter, parts)} is not there.`);
    }

    return {
      entries: volumeEntries(entries, before ? ((await listed(before, parts)) ?? []) : null),
      note: null,
    };
  } catch (error: any) {
    return none(`${letter}: could not be read: ${error?.message ?? error}`);
  }
}

/** A file's bytes, as the drive holds it now; null where it is not there. */
export async function fileBytes(letter: string, parts: string[]): Promise<Uint8Array | null> {
  if (letter === 'C') {
    const root = await treeNow();

    return (root && nodeAt(root, parts)?.data) ?? null;
  }

  const set = machineBrowsed().drives.find((one) => one.letter === letter);

  if (!set || set.ejected) {
    return null;
  }

  const file = await (await volumesOf(set)).now.open(parts);
  const size = file?.info?.size ?? file?.size;

  if (!file?.read || size === undefined) {
    return null;
  }

  return new Uint8Array(size ? await file.read(0, size) : new ArrayBuffer(0));
}

/** A file downloaded to the user's machine, its bytes as the drive holds them, by its own name. */
export async function downloadFile(letter: string, parts: string[]) {
  const path = pathText(letter, parts);
  const bytes = await fileBytes(letter, parts);

  if (!bytes) {
    status(`${path} could not be read.`, 'error');
    return;
  }

  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));

  link.href = url;
  link.download = parts.at(-1)!;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status(`${path} downloaded.`);
}

/**
 * A program on a drive, as the Programs list offers it, where it is
 * listed there; else as its bytes tell it, a Windows program or a DOS one.
 */
export async function programAt(letter: string, parts: string[]): Promise<Program> {
  const path = pathText(letter, parts);
  const machine = machineBrowsed();
  const listed = [
    ...(machine.plan?.programs ?? []),
    ...(machine.drivePrograms.get(letter) ?? []),
  ].find((program) => program.path === path);

  if (listed) {
    return listed;
  }

  const bytes = await fileBytes(letter, parts);

  return { path, parts, kind: bytes && isWindowsProgram(bytes) ? 'windows' : 'dos' };
}

/** A Windows program on a drive run, as the Programs list runs one; a DOS one said not to be. */
export async function runFile(letter: string, parts: string[]) {
  const program = await programAt(letter, parts);

  if (program.kind !== 'windows') {
    status(`${program.path} is a DOS program, which is not run here.`, 'error');
    return;
  }

  await run(machineBrowsed(), program);
}

/** Whether a name is a program's: an `.EXE`. */
export const isProgram = (name: string) => /\.EXE$/i.test(name);
