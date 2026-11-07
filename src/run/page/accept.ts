/**
 * Files dropped or chosen, read and taken: a Windows -- an installation, an
 * asset bundle, or the setup disks' images to make one -- programs' archives
 * kept as programs of their own, and disk and CD images as drives.
 */

import { Assets } from '../../assets/bundle.js';
import { type AssetInput } from '../../assets/make.js';
import { type Archive } from '../drive.js';
import { programLayer } from '../drive.js';
import { imageKind, isKnownMedia, type KnownFiles } from '../drives.js';
import { classify, installerOf, makeFromMedia } from '../media.js';
import {
  forgetAllChanges,
  forgetAllPrograms,
  forgetAssets,
  forgetChanges,
  forgetWindows,
  identify,
  type KeptProgram,
  keepProgram,
  programChangesKey,
  programIdentity,
  recallChangesAt,
  rememberAssets,
  rememberChanges,
  rememberWindows,
} from '../store.js';
import {
  addToDrive,
  diskOf,
  fillNeeded,
  keyOf,
  mediaChanged,
  mediaNow,
  mountNeeded,
  mountTaken,
  type Read,
  rememberImages,
  takeCues,
  type Taken,
} from './images.js';
import { closeMachine, hold, offerDisplays, rebuild } from './machine.js';
import {
  baseNow,
  current,
  handles,
  type Machine,
  machineOf,
  machines,
  publish,
  stacks,
  state,
  status,
} from './state.js';
import { installerName } from './view.js';

/**
 * An asset bundle taken in place of what Windows the page had, and
 * remembered; why it could not be kept, where it could not. What programs
 * wrote against another Windows goes with it.
 */
async function takeAssets(machine: Machine, name: string, bytes: Uint8Array) {
  const assets = await Assets.fromZip(bytes);
  const same = !state.windows && state.assets?.id === assets.id;

  if (!same) {
    await Promise.all([forgetAllChanges(), forgetPrograms()]);
    machine.kept = { installation: null, changes: [] };
  }

  state.windows = null;
  state.installation = null;
  state.assets = assets;
  await forgetWindows();

  try {
    await rememberAssets({ name, bytes });
  } catch (error: any) {
    return `The asset bundle could not be kept in this browser, and is to be dropped again next time: ${error?.message ?? error}`;
  }

  return null;
}

/**
 * A bundle made from the media dropped; where they are not enough alone --
 * no SETUP.INF among them, the driver's files dropped after the disks --
 * with the media dropped before them.
 */
async function bundleFrom(media: AssetInput[]) {
  try {
    const made = await makeFromMedia(media);

    state.media = media;
    return made;
  } catch (error: any) {
    if (!state.media.length || !/SETUP\.INF/.test(String(error?.message))) {
      throw error;
    }

    const all = [...state.media, ...media];
    const made = await makeFromMedia(all);

    state.media = all;
    return made;
  }
}

/** What came with files dropped or chosen. */
export interface Accepting {
  /** Their File System Access handles, where the browser gave them, matched by name. */
  handles?: unknown[];

  /** A drive's row they were dropped on, to go in its set. */
  into?: string | null;

  /** Whether they were given as drives -- added, or chosen again -- and so are no media for the maker. */
  drives?: boolean;
}

/** The known media's files, read once. */
let knownFiles: Promise<KnownFiles> | null = null;

/** What the page says of an archive with an installer, dropped. */
function offerText(archive: Archive) {
  return `${archive.name} holds an installer, ${installerName(archive, installerOf(archive.entries))}: install it, or keep it as a program.`;
}

/**
 * Files dropped or chosen. A disk or CD image (`imageKind`) is a drive
 * beside Windows (`kb/topics/drives-and-disks.md`, "The page's drives"),
 * mounted on the machine as it is, with nothing else made afresh; it is
 * the user's Windows 3.1 setup disk for the asset maker only where there is
 * no Windows yet, or it is one of the media WinBox knows (`isKnownMedia`).
 * An image a kept program asked for again is taken for it. Anything else
 * is read as before (`classify`).
 */
export async function accept(
  files: File[],
  { handles: given = [], into = null, drives = false }: Accepting = {}
) {
  if (!files.length) {
    return;
  }

  /* The machine shown as they came: what they are, they are for it. */
  const machine = current();

  status(`Reading ${files.map((file) => file.name).join(', ')}…`);

  const handleOf = (file: File) =>
    given.find((handle: any) => handle?.kind === 'file' && handle?.name === file.name) ?? null;
  const images: Taken[] = [];
  const rest: { file: File; bytes: Uint8Array }[] = [];
  const read: Read[] = [];
  let filled = false;
  let classified: Awaited<ReturnType<typeof classify>>[];
  let paired: string[];

  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const handle = handleOf(file);

      if (fillNeeded(file, bytes, handle)) {
        filled = true;
        continue;
      }

      read.push({ file, bytes, handle });
    }

    /* Cue sheets with their files, and files for those still wanting them. */
    const cues = await takeCues(read);

    images.push(...cues.taken);
    paired = cues.said;

    for (const { file, bytes, handle } of read.filter((one) => !cues.used.has(one))) {
      const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
      const kind = zip ? null : await imageKind(file.name, bytes);

      if (kind) {
        const disk = diskOf(file, bytes);

        if (handle) {
          handles.set(keyOf(disk), handle);
        }

        images.push({ disk, kind });
      } else {
        rest.push({ file, bytes });
      }
    }

    classified = await Promise.all(rest.map(({ file, bytes }) => classify(file.name, bytes)));
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
    return;
  }

  /* A floppy is the maker's where there is no Windows to run it beside,
   * or it is one of Windows' own disks; a disc or a hard disk never is. */
  const windowsHere =
    Boolean(baseNow(machine.display)) ||
    classified.some((one) => one.kind === 'bundle' || one.kind === 'installation');
  const asDrives: Taken[] = [];
  const asMedia: Taken[] = [];
  const guessed: Taken[] = [];

  for (const image of images) {
    if (drives || image.kind !== 'floppy') {
      asDrives.push(image);
    } else if (!windowsHere) {
      asMedia.push(image);
      guessed.push(image);
    } else {
      knownFiles ??= import('../../../scripts/assets/known-media.json').then(
        (json) => json.default as KnownFiles
      );
      ((await isKnownMedia(image.disk.bytes, await knownFiles).catch(() => false))
        ? asMedia
        : asDrives
      ).push(image);
    }
  }

  /* Drives alone: put in, with nothing made afresh, so a program running
   * -- an installer asking for its next disk -- goes on. */
  if (!rest.length && !asMedia.length) {
    const said = [
      ...paired,
      ...(asDrives.length
        ? into
          ? await addToDrive(machine, into, asDrives)
          : await mountTaken(machine, asDrives)
        : []),
    ];

    publish();

    if (filled) {
      await mountNeeded();
      await mediaChanged(machine);
      said.push(
        state.needed.some((one) => !one.disk) ? 'More images are asked for.' : 'Every image is had.'
      );
    }

    status(said.join(' ') || 'Ready.');
    return;
  }

  /* A Windows dropped: the other machines, on the Windows it replaces,
   * closed, what they wrote kept first; this one made afresh on it. */
  if (classified.some((one) => one.kind === 'bundle' || one.kind === 'installation')) {
    await closeOthers(machine);
  }

  /* What the machine wrote kept, against the Windows it ran. */
  await hold(machine);

  let note: string | null = null;
  let offered: string | null = null;

  try {
    const media: AssetInput[] = asMedia.map((image) => ({
      name: image.disk.name,
      bytes: image.disk.bytes,
    }));
    const archives: Archive[] = [];

    for (const [at, dropped] of classified.entries()) {
      const { file, bytes } = rest[at];

      switch (dropped.kind) {
        case 'bundle':
          note = await takeAssets(machine, file.name, bytes);
          break;
        case 'installation': {
          const installation = await identify({ name: file.name, bytes });

          /* What programs wrote on another installation is not put on this one. */
          if (installation !== state.installation) {
            await Promise.all([forgetAllChanges(), forgetPrograms()]);
            machine.kept = { installation: null, changes: [] };
          }

          state.windows = { name: file.name, entries: dropped.entries };
          state.installation = installation;
          state.assets = null;
          await Promise.all([rememberWindows({ name: file.name, bytes }), forgetAssets()]);
          break;
        }
        case 'media':
          media.push(dropped.input);
          break;
        case 'programs':
          archives.push({ name: file.name, entries: dropped.entries });
          break;
      }
    }

    /* The disks made into a bundle here, as `pnpm assets` makes one. */
    if (media.length) {
      status(`Making the asset bundle from ${media.map((one) => one.name).join(', ')}…`);

      try {
        const made = await bundleFrom(media);

        note = await takeAssets(machine, 'winbox-assets.zip', made.zip);
      } catch (error) {
        /* Floppies taken for Windows' disks for want of Windows, and not
         * Windows' disks after all: drives, once there is Windows. */
        if (media.length !== guessed.length) {
          throw error;
        }

        asDrives.push(...guessed);
        note =
          `${guessed.map((image) => image.disk.name).join(', ')}: not Windows 3.1's setup disks, ` +
          'and mounted as drives. Drop Windows to run programs from them.';
      }
    }

    /* The programs kept over the Windows dropped with them, if any; the
     * last of them chosen. One with an installer is offered to install, or
     * to keep as it is: the last of those, where there is Windows. */
    for (const archive of archives) {
      if (installerOf(archive.entries) && baseNow(machine.display)) {
        state.offer = archive;
        machine.driveOffer = null;
        machine.installing = null;
        offered = offerText(archive);
        continue;
      }

      note = (await takeProgram(machine, archive)) ?? note;
    }

    if (asDrives.length || paired.length) {
      const said = [
        ...paired,
        ...(asDrives.length
          ? into
            ? await addToDrive(machine, into, asDrives)
            : await mountTaken(machine, asDrives)
          : []),
      ];

      offered ??= said.join(' ');
    }

    if (filled) {
      await mountNeeded();
    }
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
    machine.rebuilding = false;
    return;
  }

  offerDisplays();

  if (await rebuild(machine, { keeping: false })) {
    status(note ?? offered ?? 'Ready.', note ? 'error' : 'info');
  }
}

/**
 * A program's archive dropped: kept as a program of its own, a layer laid
 * at `C:\\<NAME>` over the base C: is now, and chosen, so that C: is its
 * stack and its programs are offered to run. Where there is no Windows to
 * keep it over, or it cannot be kept, it is put on C: loose, as before,
 * until the page is left; why, where it could not be kept.
 */
export async function takeProgram(machine: Machine, archive: Archive) {
  const loose = () => {
    state.archives = [...state.archives.filter((one) => one.name !== archive.name), archive];
    machine.program = null;
  };
  const display = machine.display;
  const base = baseNow(display);

  if (!base) {
    loose();
    return null;
  }

  const name = archive.name.replace(/\.zip$/i, '');

  /* Kept again over a program of the name another machine runs: that
   * machine closed, what it wrote kept first, this one to run it. */
  const other = machineOf(name);

  if (other && other !== machine) {
    await closeMachine(other);
  }
  let made;

  try {
    made = await programLayer(
      archive,
      state.windows,
      state.windows ? null : (state.assets?.compose(display) ?? null)
    );
  } catch (error: any) {
    loose();
    return `${archive.name} is on C: until the page is left, and not kept: ${error?.message ?? error}`;
  }

  const { id } = made.layer.manifest;
  const program: KeptProgram = {
    name,
    base,
    display,
    mode: machine.mode,
    layers: [id],
    exes: made.programs,
    orders: { [id]: made.order },
    kept: Date.now(),
    media: mediaNow(machine),
  };

  /* What a program of this name wrote on a stack since changed: put on
   * the new one, or forgotten, as the user says -- the browser's own
   * confirmation, which a screen reader reads and the keyboard answers. */
  const identity = programIdentity(name, base, display, program.layers);
  const before = await recallChangesAt(programChangesKey(name));

  if (before && before.installation !== identity && before.changes.length) {
    const again = confirm(
      `${name} was kept before, and what it wrote with it. Put what it wrote on the ${name} dropped now? Cancel forgets it.`
    );

    await (again
      ? rememberChanges({ installation: identity, changes: before.changes }).catch(() => undefined)
      : forgetChanges(before.installation));
  }

  try {
    await keepProgram(program, [made.layer]);
    await rememberImages(machine, program);
  } catch (error: any) {
    loose();
    return `${archive.name} could not be kept in this browser, and is on C: until the page is left: ${error?.message ?? error}`;
  }

  stacks.set(name, [made.layer]);
  state.programs = [...state.programs.filter((one) => one.name !== name), program];
  state.archives = state.archives.filter((one) => one.name !== archive.name);
  machine.program = name;
  return null;
}

/** Every machine but one closed, what each wrote kept first: a Windows dropped replaces theirs. */
export async function closeOthers(machine: Machine) {
  for (const other of machines.filter((one) => one !== machine)) {
    await closeMachine(other);
  }
}

/** Every program kept forgotten, with what they wrote: they were made on a Windows now gone. */
export async function forgetPrograms() {
  await forgetAllPrograms();
  state.programs = [];
  state.offer = null;
  state.needed = [];
  stacks.clear();

  for (const machine of machines) {
    machine.program = null;
    machine.driveOffer = null;
    machine.installing = null;
  }
}

/**
 * Images chosen to add as drives -- or to a drive's set, `into` -- through
 * the browser's file picker of handles where it has one
 * (`showOpenFilePicker`, Chromium), so that a kept program can be run with
 * them again without a copy; else the page's own file input.
 */
export async function chooseImages(input: HTMLInputElement, into: string | null = null) {
  const picker = (globalThis as any).showOpenFilePicker;

  if (typeof picker !== 'function') {
    input.click();
    return;
  }

  try {
    const chosen: any[] = await picker({
      multiple: true,
      types: [
        {
          description: 'Disk and CD images',
          accept: {
            'application/octet-stream': ['.img', '.ima', '.dsk', '.vfd', '.iso', '.bin', '.cue'],
          },
        },
      ],
    });
    const files = await Promise.all(chosen.map((handle) => handle.getFile()));

    await accept(files, { drives: true, handles: chosen, into });
  } catch {
    /* Nothing chosen. */
  }
}

/**
 * Files dropped: with their File System Access handles, where the browser
 * gives them -- asked for at once, as a drop's items are had only while
 * its event is handled -- onto a drive's row, or the page's drop.
 */
export function dropped(transfer: DataTransfer | null, letter: string | null = null) {
  const items = [...(transfer?.items ?? [])].filter((item) => item.kind === 'file');
  const asked = items.map((item) => (item as any).getAsFileSystemHandle?.() ?? null);
  const files = [...(transfer?.files ?? [])];

  Promise.all(
    asked.map((one: Promise<unknown> | null) => (one ?? Promise.resolve(null)).catch(() => null))
  ).then((got) => accept(files, { handles: got, into: letter, drives: letter !== null }));
}
