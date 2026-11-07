/**
 * Installing on the page (`kb/formats/layer.md`, "Installing on the page"),
 * and the programs kept: an installer run over a stack, on a machine, what
 * it wrote kept as a layer or discarded, and a kept program opened on a
 * machine of its own, or forgotten.
 */

import { type Change } from '../changes.js';
import { layerPrograms } from '../drive.js';
import { installedLayer, type MediaReference } from '../../layers/install.js';
import { type LayerEntry, type LayerManifest, touching } from '../../layers/layer.js';
import { installerOf } from '../media.js';
import {
  forgetProgram,
  type KeptProgram,
  keepProgram,
  programChangesKey,
  programIdentity,
  recallChangesAt,
  rememberChanges,
} from '../store.js';
import { takeProgram } from './accept.js';
import { mediaNow, mountMedia, rememberImages } from './images.js';
import { addMachine, closeMachine, hold, rebuild, run, select } from './machine.js';
import {
  baseNow,
  current,
  identityOf,
  type Machine,
  machineOf,
  machines,
  programOf,
  publish,
  runningOn,
  stacks,
  state,
  status,
} from './state.js';
import {
  type DriveOffer,
  freeName,
  installerName,
  MEDIA,
  programName,
  stillWanted,
} from './view.js';

/** The program chosen to install into, as the install section offers it; none for one of its own. */
const intoNow = () => state.installInto || null;

/**
 * The machine an installer is run on: the one running the program it
 * installs into, where one does -- what it installs is that program's, and
 * no second machine is to run its stack -- shown; else the machine shown.
 */
function installerMachine(into: string | null) {
  const running = into ? machineOf(into) : null;

  if (running && running !== current()) {
    select(running);
  }

  return running ?? current();
}

/**
 * An archive with an installer, run: its archive put on C: as its media,
 * at `C:\WBSETUP`, over the stack of the program chosen to install into,
 * or the base alone, with an empty top; and its installer started there.
 * What it writes is kept only once its task has ended, and the user says
 * so (`keepInstalled`).
 */
export async function install() {
  const shown = current();

  if (shown.driveOffer) {
    return installFromDrive(shown, shown.driveOffer);
  }

  const archive = state.offer;
  const installer = archive && installerOf(archive.entries);

  if (!archive || !installer) {
    return;
  }

  const into = intoNow();
  const machine = installerMachine(into);
  const media = { name: `${MEDIA}.zip`, entries: archive.entries };

  await hold(machine);
  state.offer = null;
  machine.installing = {
    name: into ?? programName(archive),
    from: archive.name,
    media,
    drive: null,
    installer: '',
    into,
    ended: false,
  };

  if (!(await rebuild(machine, { keeping: false }))) {
    machine.installing = null;
    publish();
    return;
  }

  /* Its installer where the plan put it, under an 8.3 name. */
  const { plan } = machine;
  const placed = plan?.placements.find(
    (placement) => placement.original === `${media.name}/${installer}`
  );
  const program = plan?.programs.find(
    (one) => placed && one.kind === 'windows' && one.parts.join('\\') === placed.parts.join('\\')
  );

  if (!program) {
    status(
      `${installerName(archive, installer)} is not a Windows program, and is not run here.`,
      'error',
      machine
    );
    return;
  }

  machine.installing.installer = program.path;
  publish();
  await run(machine, program, { install: true });
}

/**
 * An installer on a drive of images run (`kb/formats/layer.md`, "Media on
 * another drive"): from its floppy or disc, its drive current, over the
 * stack of the program chosen to install into, or the base alone, with an
 * empty top; nothing of its media is put on C:. What it writes is kept
 * only once its task has ended, and the user says so (`keepInstalled`).
 * It runs on the machine whose drive it is on.
 */
async function installFromDrive(machine: Machine, offer: DriveOffer) {
  const into = intoNow();
  const set = machine.drives.find((one) => one.letter === offer.letter);

  if (!set || set.ejected) {
    status(`${offer.letter}: has no disk in it to install from.`, 'error', machine);
    return;
  }

  await hold(machine);
  machine.driveOffer = null;
  machine.installing = {
    name: into ?? offer.name,
    from: `${offer.letter}: ${set.disks[set.current].name}`,
    media: null,
    drive: offer.letter,
    installer: offer.installer.path,
    into,
    ended: false,
  };

  if (!(await rebuild(machine, { keeping: false }))) {
    machine.installing = null;
    publish();
    return;
  }

  publish();
  await run(machine, offer.installer, { install: true });
}

/**
 * What the installer on the machine shown wrote kept as a layer
 * (`installedLayer`): its top's changes, those naming its media dropped,
 * over the stack it ran on; and the program kept with it -- one of its
 * own, or the program it installed into with the layer added over its
 * others, as programs sharing a machine are installed in turn. What that
 * program wrote before is put on its new stack, but where the installer
 * wrote. The machine then runs the program, its stack on C:.
 */
export async function keepInstalled() {
  const machine = current();
  const installing = machine.installing;
  const base = baseNow(machine.display);

  if (!installing?.ended || !base) {
    return;
  }

  let changes: Change[] | null = null;

  try {
    changes = await (await machine.engine).changes();
  } catch (error) {
    console.error(error);
  }

  if (!changes) {
    status('What the installer wrote could not be read.', 'error', machine);
    return;
  }

  const into = state.programs.find((one) => one.name === installing.into) ?? null;
  const { layer, references } = await installedLayer(changes, {
    media: installing.drive ? [`${installing.drive}:\\`] : [MEDIA],
    over: [base, ...(into?.layers ?? [])],
    made: { by: 'WinBox run page', from: installing.from },
  });

  if (!layer.manifest.entries.length) {
    status('The installer wrote nothing on C: to keep.', 'error', machine);
    return;
  }

  const { id } = layer.manifest;
  const exes = layerPrograms(layer);
  /* The images it is run with: those in the drives, but the floppies it
   * was installed from, which a program installed needs no more; a disc
   * installed from is kept, as a program on a CD reads it as it runs. */
  const media = mediaNow(
    machine,
    machine.drives.find((set) => set.letter === installing.drive && set.kind === 'floppy')?.letter
  );
  const program: KeptProgram = into
    ? {
        ...into,
        layers: [...into.layers, id],
        exes: [...into.exes, ...exes.filter((exe) => !into.exes.includes(exe))],
        media: [
          ...(into.media ?? []).filter(
            (one) => !media.some((other) => other.letter === one.letter)
          ),
          ...media,
        ],
      }
    : {
        name: freeName(state.programs, installing.name),
        base,
        display: machine.display,
        layers: [id],
        exes,
        orders: {},
        kept: Date.now(),
        media,
      };

  try {
    await keepProgram(program, [layer]);
    await rememberImages(machine, program);

    if (into) {
      await carryChanges(into, program, layer.manifest);
    }
  } catch (error: any) {
    status(
      `What the installer wrote could not be kept: ${error?.message ?? error}`,
      'error',
      machine
    );
    return;
  }

  await hold(machine, { keeping: false });
  stacks.delete(program.name);
  state.programs = [...state.programs.filter((one) => one.name !== program.name), program];
  machine.program = program.name;
  machine.installing = null;

  if (await rebuild(machine, { keeping: false })) {
    status(installedText(program.name, layer.manifest, references, installing.drive));
  }
}

/** What the page says of a program installed and kept: from its drive of images, where it was. */
function installedText(
  name: string,
  manifest: LayerManifest,
  references: MediaReference[],
  drive: string | null = null
) {
  const files = manifest.entries.filter((entry) => entry.kind === 'file').length;
  const naming = references.map((reference) => `C:\\${reference.path}: ${reference.line}`);

  return (
    (drive
      ? `Installed ${name} from ${drive}:, its ${files} files kept as a layer.`
      : `Installed ${name}, its ${files} files kept as a layer, its setup files let go of.`) +
    (naming.length
      ? ` What it wrote still names them, which are not kept: ${naming.join('; ')}.`
      : '')
  );
}

/**
 * What a program wrote, kept against its stack before a layer was
 * installed into it, put on its new stack: but where the installer wrote,
 * for there the installer's is the newer (`touching`).
 */
async function carryChanges(was: KeptProgram, now: KeptProgram, manifest: LayerManifest) {
  const before = await recallChangesAt(programChangesKey(was.name));

  if (!before?.changes.length) {
    return;
  }

  const entryOf = (change: Change): LayerEntry =>
    change.kind === 'file'
      ? { kind: 'file', path: change.path, sha256: '', size: 0, modified: change.modified }
      : change.kind === 'folder'
        ? { kind: 'folder', path: change.path, modified: change.modified }
        : { kind: 'removed', path: change.path };
  const touched = (change: Change) =>
    touching({ ...manifest, entries: [entryOf(change)] }, manifest) !== undefined;

  await rememberChanges({
    installation: programIdentity(now.name, now.base, now.display, now.layers),
    changes: before.changes.filter((change) => !touched(change)),
  });
}

/** The installer's run on the machine shown let go of, and what it wrote with it. */
export async function discardInstall() {
  const machine = current();

  await hold(machine, { keeping: false });
  machine.installing = null;

  if (await rebuild(machine, { keeping: false })) {
    status('Discarded what the installer wrote.');
  }
}

/** The archive with an installer kept as it is, a program of its own, as any archive is. */
export async function keepAsProgram() {
  const archive = state.offer;
  const machine = current();

  if (!archive) {
    return;
  }

  await hold(machine);
  state.offer = null;

  const note = await takeProgram(machine, archive);

  if (await rebuild(machine, { keeping: false })) {
    status(note ?? `${programName(archive)} is on C:.`, note ? 'error' : 'info');
  }
}

/**
 * A kept program opened (`kb/guides/launcher.md`, design A): the machine
 * running it shown, where one does; else a machine of its own made, in a
 * tab after the others, on the display it was made on, and shown -- its
 * images mounted or asked for again first, while the click's leave to ask
 * for a file's handle again holds. Its machine, or null where it could not
 * be made.
 */
export async function open(name: string) {
  const program = state.programs.find((one) => one.name === name);

  if (!program) {
    return null;
  }

  const running = machineOf(name);

  if (running) {
    select(running);
    return running;
  }

  if (!state.displays.includes(program.display)) {
    status(`${name} was made on a display this Windows does not offer.`, 'error');
    return null;
  }

  const machine = addMachine({ program: name, display: program.display });

  select(machine);

  if (program.media?.length) {
    await mountMedia(machine, program);
  }

  if (!(await rebuild(machine, { keeping: false }))) {
    return null;
  }

  const needed = state.needed.filter((one) => one.program === name && !one.disk);

  status(
    needed.length
      ? `${name} is on C:. Choose again, or drop, the images it is run with: ` +
          `${needed
            .flatMap((one) => stillWanted(one).map((file) => `${file.name} for ${one.letter}:`))
            .join(', ')}.`
      : `${name} is on C:.`
  );
  return machine;
}

/**
 * A machine made afresh on another of its settings -- its display, its
 * coprocessor -- where no other machine runs the stack that makes it, as
 * no two machines keep what they write in one place (`runningOn`): that
 * one shown instead, and this left as it was. Whether it was made.
 */
export async function remake(machine: Machine, change: () => () => void) {
  const undo = change();
  const other = machine.installing ? null : runningOn(identityOf(machine), machine);

  if (other) {
    undo();
    publish();
    select(other);
    status('That machine runs in another tab, shown now.');
    return false;
  }

  machine.installing = null;
  publish();
  return rebuild(machine);
}

/**
 * A program kept forgotten, and what it wrote; its layers and blobs, where
 * no other has them. Each machine running it is closed, what it wrote not
 * kept, as it is forgotten.
 */
export async function forgetKept(name: string) {
  const running = machines.filter((one) => programOf(one)?.name === name && !one.installing);

  for (const machine of running) {
    await hold(machine, { keeping: false });
  }

  try {
    await forgetProgram(name);
  } catch (error: any) {
    for (const machine of machines) {
      machine.rebuilding = false;
    }

    status(`${name} could not be forgotten: ${error?.message ?? error}`, 'error');
    return;
  }

  stacks.delete(name);
  state.programs = state.programs.filter((one) => one.name !== name);

  /* A machine that would run it on its own display, on another now, runs the base there still. */
  for (const machine of machines.filter((one) => one.program === name)) {
    machine.program = null;
  }

  for (const machine of running) {
    await closeMachine(machine, { keeping: false });
  }

  publish();
  status(`Forgot ${name}, and what it wrote.`);
}
