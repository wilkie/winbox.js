/**
 * The drives of images beside C: (`kb/topics/drives-and-disks.md`, "The
 * page's drives"): images taken as drives, their disks put in and taken
 * out, saved, let go of; and the images a kept program is run with,
 * remembered and asked for again.
 */

import { type Program } from '../drive.js';
import {
  assignLetters,
  type Disk,
  type DriveSet,
  imageKey,
  type ImageKind,
  missingOf,
  orderSet,
  pairCues,
  programsOn,
  setText,
  volumeOf,
} from '../drives.js';
import {
  type KeptProgram,
  type Medium,
  recallImage,
  rememberImage,
  rememberProgram,
} from '../store.js';
import { drivePrograms, handles, programNow, publish, session, state, status } from './state.js';
import { type Needed, stillWanted } from './view.js';

/** An image read from a file dropped or chosen: its disk, kind and handle. */
export interface Taken {
  disk: Disk;
  kind: ImageKind;
}

/** A file dropped or chosen, read: its bytes, and its handle where the browser gave one. */
export interface Read {
  file: File;
  bytes: Uint8Array;
  handle: unknown;
}

/** A disk made of a file read. */
export const diskOf = (file: File, bytes: Uint8Array): Disk => ({
  name: file.name,
  size: file.size,
  modified: file.lastModified,
  bytes,
  written: false,
});

/** A disk's key, which tells its file again (`imageKey`). */
export const keyOf = (disk: Disk) => imageKey(disk.name, disk.size, disk.modified);

/** A file read made a disk, its handle kept by its key. */
function diskRead(one: Read) {
  const disk = diskOf(one.file, one.bytes);

  if (one.handle) {
    handles.set(keyOf(disk), one.handle);
  }

  return disk;
}

/**
 * Cue sheets among files read, each paired with the files it names among
 * those read with it (`pairCues`) -- a disc of its own once it has them
 * all, as DOSBox's `LoadCueSheet` reads it; else asked for by name until
 * they are dropped or chosen too. What was made discs, which files were
 * used, and what is said of them.
 */
export async function takeCues(read: Read[]) {
  const disks = new Map(read.map((one) => [diskRead(one), one]));
  const paired = pairCues([...disks.keys()], session.wanting);
  const taken: Taken[] = [];
  const said: string[] = [];

  session.wanting = paired.wanting;

  for (const disc of paired.discs) {
    try {
      await volumeOf('iso', disc);
      taken.push({ disk: disc, kind: 'iso' });
    } catch (error: any) {
      said.push(`${disc.name}: ${error?.message ?? error}.`);
    }
  }

  /* Said of a sheet dropped now, or given a file now: the rest were said before. */
  for (const wait of session.wanting.filter(
    (one) => disks.has(one.cue) || one.tracks.some((track) => track && disks.has(track))
  )) {
    said.push(`${wait.cue.name} wants ${missingOf(wait).join(', ')}: drop or choose it too.`);
  }

  const used = new Set([...paired.used].map((disk) => disks.get(disk)!));

  return { taken, used, said };
}

/**
 * The drives made these sets, in the order of their letters: in place, as
 * the engine holds the same array (`Setup.drives`) for the machine it makes
 * afresh once Windows has ended.
 */
function setDrives(sets: DriveSet[]) {
  const sorted = [...sets].sort((one, other) => one.letter.localeCompare(other.letter));

  state.drives.splice(0, state.drives.length, ...sorted);
}

/**
 * The programs on a drive's disk read again: none where it is empty. An
 * installer on it is offered (`driveRows`).
 */
async function readPrograms(set: DriveSet) {
  if (set.ejected) {
    drivePrograms.delete(set.letter);
    return;
  }

  try {
    const volume = await volumeOf(set.kind, set.disks[set.current]);

    drivePrograms.set(set.letter, await programsOn(volume, set.letter));
  } catch {
    drivePrograms.delete(set.letter);
  }
}

/**
 * Images taken as drives: floppies dropped together one set, in the order
 * of their names, as discs are; a hard disk's image a drive of its own;
 * each set given its letter as the owner chose (`assignLetters`), or the
 * letter asked for -- a kept program's, pinned. Mounted on the machine as
 * it is, so a program running sees them at once. What could not be, said.
 */
export async function mountTaken(taken: Taken[], letters: Record<string, string> = {}) {
  const groups: { kind: ImageKind; disks: Disk[]; letter?: string }[] = [];

  for (const kind of ['floppy', 'iso'] as const) {
    const disks = orderSet(taken.filter((one) => one.kind === kind).map((one) => one.disk));

    if (disks.length) {
      groups.push({ kind, disks, letter: letters[keyOf(disks[0])] });
    }
  }

  for (const one of taken.filter((image) => image.kind === 'hdd')) {
    groups.push({ kind: 'hdd', disks: [one.disk], letter: letters[keyOf(one.disk)] });
  }

  const given = assignLetters(groups, state.drives);
  const said: string[] = [];
  const current = session.made;

  for (const [at, group] of groups.entries()) {
    const letter = given[at];

    if (letter instanceof Error) {
      said.push(`${group.disks.map((disk) => disk.name).join(', ')}: ${letter.message}.`);
      continue;
    }

    const set: DriveSet = {
      letter,
      kind: group.kind,
      disks: group.disks,
      current: 0,
      ejected: false,
    };
    const refused = await current?.mount(set);

    if (refused) {
      current?.unmount(letter);
      said.push(`${refused}.`);
      continue;
    }

    setDrives([...state.drives, set]);
    await readPrograms(set);
    said.push(`${letter}: ${setText(set)}.`);
  }

  await mediaChanged();
  publish();
  return said;
}

/**
 * Images dropped on a drive's row put in its set, after its disks, in
 * the order of their names; the first of them put in the drive.
 */
export async function addToDrive(letter: string, taken: Taken[]) {
  const set = state.drives.find((one) => one.letter === letter);

  if (!set) {
    return mountTaken(taken);
  }

  if (taken.some((one) => one.kind !== set.kind) || set.kind === 'hdd') {
    return [
      set.kind === 'hdd'
        ? `${letter}: is a hard disk's image, which is alone.`
        : `${letter}: takes ${set.kind === 'iso' ? 'discs' : 'floppies'} alone.`,
    ];
  }

  const first = set.disks.length;

  for (const disk of orderSet(taken.map((one) => one.disk))) {
    set.disks.push(disk);

    const refused = await session.made?.addDisk(set, set.disks.length - 1);

    if (refused) {
      set.disks.pop();
      publish();
      return [`${refused}.`];
    }
  }

  await mediaChanged();
  return [await insertDisk(letter, first)];
}

/** A drive's disk, from nought, put in it; what is said of it. */
export async function insertDisk(letter: string, disk: number) {
  const set = state.drives.find((one) => one.letter === letter);

  if (!set || disk >= set.disks.length) {
    return `${letter}: has no disk ${disk + 1}.`;
  }

  const refused = session.made?.insert(letter, disk) ?? null;

  if (refused) {
    return `${refused}.`;
  }

  set.current = disk;
  set.ejected = false;
  await readPrograms(set);
  publish();
  return `${letter}: ${setText(set)}.`;
}

/** A drive's next disk put in, the first after the last; the one after the disk taken out where it is empty. */
export const nextDisk = (set: DriveSet) =>
  insertDisk(set.letter, (set.current + 1) % set.disks.length);

/** A drive's disk taken out, the drive left empty. */
export async function ejectDisk(set: DriveSet) {
  const refused = session.made?.eject(set.letter) ?? null;

  if (refused) {
    return `${refused}.`;
  }

  set.ejected = true;
  await readPrograms(set);
  publish();
  return `${set.letter}: ${setText(set)}.`;
}

/** A drive's images let go of, and the drive with them. */
export async function removeDrive(set: DriveSet) {
  session.made?.unmount(set.letter);
  setDrives(state.drives.filter((one) => one !== set));
  drivePrograms.delete(set.letter);

  if (state.driveOffer?.letter === set.letter) {
    state.driveOffer = null;
  }

  await mediaChanged();
  publish();
  return `${set.letter}: is no more.`;
}

/**
 * The disk in a drive saved as programs have written it, as a new file
 * the browser downloads (the owner's decision 1): the image dropped is
 * never written, and is not offered to be written over.
 */
export function saveImage(set: DriveSet) {
  const disk = set.disks[set.current];
  const bytes = session.made?.diskImage(set.letter, set.current) ?? null;

  if (!bytes) {
    return `${set.letter}: has nothing to save.`;
  }

  const dot = disk.name.lastIndexOf('.');
  const name =
    dot > 0 ? `${disk.name.slice(0, dot)}-saved${disk.name.slice(dot)}` : `${disk.name}-saved`;
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));

  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const changed = session.made?.diskChanged(set.letter, set.current) || disk.written;

  return `${set.letter}: saved as ${name}${changed ? ', as programs wrote it' : ', as it was'}.`;
}

/** An installer on a drive offered to install, as an archive's is. */
export function offerDrive(set: DriveSet, installer: Program) {
  const name = set.disks[0].name.replace(/\.[^.]*$/, '');

  state.offer = null;
  state.driveOffer = { letter: set.letter, installer, name };
  publish();
  return `${set.letter}: holds an installer, ${installer.path}: install it.`;
}

/**
 * The images in the drives, as a kept program remembers them: each set's
 * in order, its letter pinned; but the drive `except`.
 */
export function mediaNow(except?: string): Medium[] {
  return state.drives
    .filter((set) => set.letter !== except)
    .flatMap((set) =>
      set.disks.map((disk) => ({
        letter: set.letter,
        kind: set.kind,
        name: disk.name,
        size: disk.size,
        key: keyOf(disk),
        ...(disk.tracks ? { tracks: disk.tracks.map(trackOf) } : {}),
      }))
    );
}

/** A cue sheet's file as a kept program remembers it. */
const trackOf = (disk: Disk) => ({ name: disk.name, size: disk.size, key: keyOf(disk) });

/**
 * What is kept of a kept program's images: a handle on each file, where
 * the browser gave one, and its bytes where a copy is asked for; nothing
 * else (the owner's decision 2: no copy of a read-only image unless asked
 * for).
 */
export async function rememberImages(program: KeptProgram) {
  const copy = state.keepImages;

  const disks = state.drives.flatMap((set) => set.disks);
  const files = [...disks, ...disks.flatMap((disk) => disk.tracks ?? [])];

  for (const medium of (program.media ?? []).flatMap((one) => [one, ...(one.tracks ?? [])])) {
    const disk = files.find((one) => keyOf(one) === medium.key);
    const handle = handles.get(medium.key);
    const was = await recallImage(medium.key);

    if (!disk || (!handle && !copy && !was)) {
      continue;
    }

    await rememberImage(medium.key, {
      name: disk.name,
      size: disk.size,
      modified: disk.modified,
      ...(handle ? { handle } : was?.handle ? { handle: was.handle } : {}),
      ...(copy ? { bytes: disk.bytes } : was?.bytes ? { bytes: was.bytes } : {}),
    }).catch((error) =>
      status(`${disk.name} could not be kept in this browser: ${error?.message ?? error}`, 'error')
    );
  }
}

/**
 * The drives changed -- a set added or let go -- while a kept program is
 * open: it is run with them from now on, and remembers them.
 */
export async function mediaChanged() {
  const program = programNow();

  if (!program || state.installing) {
    return;
  }

  /* Those it is run with and not had yet, still asked for, are kept. */
  const media = [
    ...mediaNow(),
    ...state.needed
      .filter((one) => one.program === program.name && !one.disk)
      .map(({ letter, kind, name, size, key, tracks }) => ({
        letter,
        kind,
        name,
        size,
        key,
        ...(tracks ? { tracks } : {}),
      })),
  ].sort((one, other) => one.letter.localeCompare(other.letter));

  if (JSON.stringify(media) === JSON.stringify(program.media ?? [])) {
    return;
  }

  program.media = media;

  try {
    await rememberProgram(program);
    await rememberImages(program);
  } catch (error: any) {
    status(`${program.name}'s images could not be kept: ${error?.message ?? error}`, 'error');
  }
}

/**
 * A kept program's images put in their drives as it is opened, each from
 * what is kept of it: its handle, the browser asked again for leave to
 * read it, or its copy. One not had is asked for by its name (`needed`);
 * a set is mounted once every one of its images is had.
 */
export async function mountMedia(program: KeptProgram) {
  state.needed = state.needed.filter((one) => one.program !== program.name);

  const media = (program.media ?? []).filter(
    (medium) =>
      !state.drives.some(
        (set) =>
          set.letter === medium.letter && set.disks.some((disk) => keyOf(disk) === medium.key)
      )
  );

  const recall = async (medium: Medium): Promise<Disk | null> => {
    const kept = await recallImage(medium.key);

    if (kept?.bytes) {
      return {
        name: kept.name,
        size: kept.size,
        modified: kept.modified,
        bytes: kept.bytes,
        written: false,
      };
    }

    return kept?.handle ? fromHandle(kept.handle, medium) : null;
  };

  for (const medium of media) {
    const needed: Needed = {
      ...medium,
      program: program.name,
      disk: null,
      have: await recall(medium),
      trackDisks: [],
    };

    for (const track of medium.tracks ?? []) {
      needed.trackDisks!.push(await recall({ ...medium, ...track }));
    }

    state.needed.push(completed(needed));
  }

  await mountNeeded();
}

/** An image asked for made whole once it and every file its cue sheet names are had. */
function completed(needed: Needed) {
  const tracks = needed.trackDisks ?? [];

  if (needed.have && (needed.tracks ?? []).every((_, at) => tracks[at])) {
    needed.disk = needed.tracks ? { ...needed.have, tracks: tracks as Disk[] } : needed.have;
  }

  return needed;
}

/** A disk read through a handle kept, where the browser gives leave and the file is still the one kept. */
async function fromHandle(handle: any, medium: Medium): Promise<Disk | null> {
  try {
    let leave = await handle.queryPermission?.({ mode: 'read' });

    if (leave !== 'granted') {
      leave = await handle.requestPermission?.({ mode: 'read' });
    }

    if (leave !== 'granted') {
      return null;
    }

    const file: File = await handle.getFile();

    if (file.name !== medium.name || file.size !== medium.size) {
      return null;
    }

    handles.set(medium.key, handle);
    return diskOf(file, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

/** The sets whose images are all had mounted, at the letters kept; the rest still asked for. */
export async function mountNeeded() {
  const letters = [...new Set(state.needed.map((one) => `${one.program}\n${one.letter}`))];

  for (const both of letters) {
    const [program, letter] = both.split('\n');
    const wanted = state.needed.filter((one) => one.program === program && one.letter === letter);

    if (wanted.some((one) => !one.disk)) {
      continue;
    }

    state.needed = state.needed.filter((one) => !wanted.includes(one));

    /* Whatever is at its letter now makes way for it. */
    for (const set of state.drives.filter((one) => one.letter === letter)) {
      await removeDrive(set);
    }

    const set: DriveSet = {
      letter,
      kind: wanted[0].kind,
      disks: wanted.map((one) => one.disk!),
      current: 0,
      ejected: false,
    };
    const refused = await session.made?.mount(set);

    if (refused) {
      status(`${refused}.`, 'error');
      continue;
    }

    setDrives([...state.drives, set]);
    await readPrograms(set);
  }

  publish();
}

/**
 * A file dropped or chosen that a kept program's image asked for is: the
 * same name and size. Taken for it, and its set mounted once it is whole.
 */
export function fillNeeded(file: File, bytes: Uint8Array, handle: unknown) {
  const same = (one: { name: string; size: number }) =>
    one.name === file.name && one.size === file.size;
  const needed = state.needed.find((one) => !one.disk && stillWanted(one).some(same));

  if (!needed) {
    return false;
  }

  const disk = diskOf(file, bytes);
  const track = (needed.tracks ?? []).findIndex((one, at) => !needed.trackDisks?.[at] && same(one));

  if (!needed.have && same(needed)) {
    needed.have = disk;
  } else {
    needed.trackDisks![track] = disk;
  }

  completed(needed);

  /* Its key is the file's as it is now, which the program keeps from now on. */
  const key = keyOf(disk);

  if (handle) {
    handles.set(key, handle);
  }

  return true;
}
