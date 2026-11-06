/**
 * Installing on the page (`kb/formats/layer.md`, "Installing on the page"),
 * and the programs kept: an installer run over a stack, what it wrote kept
 * as a layer or discarded, and a kept program put on C: or forgotten.
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
import { engine, hold, rebuild, run } from './machine.js';
import { baseNow, publish, session, stacks, state, status } from './state.js';
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
 * An archive with an installer, run: its archive put on C: as its media,
 * at `C:\WBSETUP`, over the stack of the program chosen to install into,
 * or the base alone, with an empty top; and its installer started there.
 * What it writes is kept only once its task has ended, and the user says
 * so (`keepInstalled`).
 */
export async function install() {
  if (state.driveOffer) {
    return installFromDrive(state.driveOffer);
  }

  const archive = state.offer;
  const installer = archive && installerOf(archive.entries);

  if (!archive || !installer) {
    return;
  }

  const into = intoNow();
  const media = { name: `${MEDIA}.zip`, entries: archive.entries };

  await hold();
  state.offer = null;
  state.installing = {
    name: into ?? programName(archive),
    from: archive.name,
    media,
    drive: null,
    installer: '',
    into,
    ended: false,
  };

  if (!(await rebuild({ keeping: false }))) {
    state.installing = null;
    publish();
    return;
  }

  /* Its installer where the plan put it, under an 8.3 name. */
  const { plan } = session;
  const placed = plan?.placements.find(
    (placement) => placement.original === `${media.name}/${installer}`
  );
  const program = plan?.programs.find(
    (one) => placed && one.kind === 'windows' && one.parts.join('\\') === placed.parts.join('\\')
  );

  if (!program) {
    status(
      `${installerName(archive, installer)} is not a Windows program, and is not run here.`,
      'error'
    );
    return;
  }

  state.installing.installer = program.path;
  publish();
  await run(program, { install: true });
}

/**
 * An installer on a drive of images run (`kb/formats/layer.md`, "Media on
 * another drive"): from its floppy or disc, its drive current, over the
 * stack of the program chosen to install into, or the base alone, with an
 * empty top; nothing of its media is put on C:. What it writes is kept
 * only once its task has ended, and the user says so (`keepInstalled`).
 */
async function installFromDrive(offer: DriveOffer) {
  const into = intoNow();
  const set = state.drives.find((one) => one.letter === offer.letter);

  if (!set || set.ejected) {
    status(`${offer.letter}: has no disk in it to install from.`, 'error');
    return;
  }

  await hold();
  state.driveOffer = null;
  state.installing = {
    name: into ?? offer.name,
    from: `${offer.letter}: ${set.disks[set.current].name}`,
    media: null,
    drive: offer.letter,
    installer: offer.installer.path,
    into,
    ended: false,
  };

  if (!(await rebuild({ keeping: false }))) {
    state.installing = null;
    publish();
    return;
  }

  publish();
  await run(offer.installer, { install: true });
}

/**
 * What the installer wrote kept as a layer (`installedLayer`): its top's
 * changes, those naming its media dropped, over the stack it ran on; and
 * the program kept with it -- one of its own, or the program it installed
 * into with the layer added over its others, as programs sharing a
 * machine are installed in turn. What that program wrote before is put on
 * its new stack, but where the installer wrote. The program is then
 * chosen, its stack on C:.
 */
export async function keepInstalled() {
  const installing = state.installing;
  const base = baseNow();

  if (!installing?.ended || !base) {
    return;
  }

  let changes: Change[] | null = null;

  try {
    changes = await (await engine).changes();
  } catch (error) {
    console.error(error);
  }

  if (!changes) {
    status('What the installer wrote could not be read.', 'error');
    return;
  }

  const into = state.programs.find((one) => one.name === installing.into) ?? null;
  const { layer, references } = await installedLayer(changes, {
    media: installing.drive ? [`${installing.drive}:\\`] : [MEDIA],
    over: [base, ...(into?.layers ?? [])],
    made: { by: 'WinBox run page', from: installing.from },
  });

  if (!layer.manifest.entries.length) {
    status('The installer wrote nothing on C: to keep.', 'error');
    return;
  }

  const { id } = layer.manifest;
  const exes = layerPrograms(layer);
  /* The images it is run with: those in the drives, but the floppies it
   * was installed from, which a program installed needs no more; a disc
   * installed from is kept, as a program on a CD reads it as it runs. */
  const media = mediaNow(
    state.drives.find((set) => set.letter === installing.drive && set.kind === 'floppy')?.letter
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
        display: state.display,
        layers: [id],
        exes,
        orders: {},
        kept: Date.now(),
        media,
      };

  try {
    await keepProgram(program, [layer]);
    await rememberImages(program);

    if (into) {
      await carryChanges(into, program, layer.manifest);
    }
  } catch (error: any) {
    status(`What the installer wrote could not be kept: ${error?.message ?? error}`, 'error');
    return;
  }

  await hold({ keeping: false });
  stacks.delete(program.name);
  state.programs = [...state.programs.filter((one) => one.name !== program.name), program];
  state.program = program.name;
  state.installing = null;

  if (await rebuild({ keeping: false })) {
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

/** The installer's run let go of, and what it wrote with it. */
export async function discardInstall() {
  await hold({ keeping: false });
  state.installing = null;

  if (await rebuild({ keeping: false })) {
    status('Discarded what the installer wrote.');
  }
}

/** The archive with an installer kept as it is, a program of its own, as any archive is. */
export async function keepAsProgram() {
  const archive = state.offer;

  if (!archive) {
    return;
  }

  await hold();
  state.offer = null;

  const note = await takeProgram(archive);

  if (await rebuild({ keeping: false })) {
    status(note ?? `${programName(archive)} is on C:.`, note ? 'error' : 'info');
  }
}

/** A program kept put on C:, its stack, or none: the base alone, with what was dropped loose. */
export async function choose(name: string | null) {
  const program = state.programs.find((one) => one.name === name) ?? null;

  /* Its images first, while the click's leave to ask for a file's
   * handle again holds. */
  state.program = name;
  state.installing = null;
  state.needed = state.needed.filter((one) => one.program === name);

  if (program?.media?.length) {
    await mountMedia(program);
  }

  await hold();

  if (await rebuild({ keeping: false })) {
    const needed = state.needed.filter((one) => !one.disk);

    status(
      !name
        ? 'Ready.'
        : needed.length
          ? `${name} is on C:. Choose again, or drop, the images it is run with: ` +
            `${needed
              .flatMap((one) => stillWanted(one).map((file) => `${file.name} for ${one.letter}:`))
              .join(', ')}.`
          : `${name} is on C:.`
    );
  }
}

/** A program kept forgotten, and what it wrote; its layers and blobs, where no other has them. */
export async function forgetKept(name: string) {
  await hold({ keeping: state.program !== name });

  try {
    await forgetProgram(name);
  } catch (error: any) {
    session.rebuilding = false;
    status(`${name} could not be forgotten: ${error?.message ?? error}`, 'error');
    return;
  }

  stacks.delete(name);
  state.programs = state.programs.filter((one) => one.name !== name);

  if (state.program === name) {
    state.program = null;
    session.kept = { installation: null, changes: [] };
    session.tooLarge = [];
  }

  if (await rebuild({ keeping: false })) {
    status(`Forgot ${name}, and what it wrote.`);
  }
}
