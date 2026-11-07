/**
 * What the run page's controls do: the actions its components call, each
 * changing the state (`state.ts`) through the modules beside this one and
 * publishing what is to be shown; and the page started, once its desktop is
 * there for the machines' screens. The side's controls act on the machine
 * shown -- its display, its drives, the install on it, what it runs --
 * taken as the action begins, so that a tab chosen meanwhile changes
 * nothing of it.
 */

import { readZip } from '../../zip.js';
import { type WindowsMode } from '../../emulator/machine.js';
import { type Program } from '../drive.js';
import {
  forgetAllChanges,
  forgetAssets,
  forgetChanges as forgetChangesKept,
  forgetWindows as forgetWindowsKept,
  identify,
  imageCounts,
  keptCounts,
  recallAssets,
  recallChanges,
  recallPrograms,
  recallWindows,
} from '../store.js';
import { Assets } from '../../assets/bundle.js';
import { accept, chooseImages, dropped, forgetPrograms } from './accept.js';
import { browse } from './browse.js';
import { ejectDisk, insertDisk, nextDisk, offerDrive, removeDrive, saveImage } from './images.js';
import { rememberImages } from './images.js';
import {
  discardInstall,
  forgetKept,
  install,
  keepAsProgram,
  keepInstalled,
  open,
  remake,
} from './install.js';
import { launch } from './launcher.js';
import {
  addMachine,
  closeMachine,
  EVERY,
  hold,
  keepAll,
  keepEvery,
  offerDisplays,
  rebuild,
  run,
  select,
} from './machine.js';
import {
  current,
  identityOf,
  type Machine,
  machines,
  programOf,
  publish,
  session,
  state,
  status,
} from './state.js';

/** What a drive's action says, said on the status line: on the machine shown, its drive by its letter. */
async function said(
  letter: string,
  act: (machine: Machine, set: Machine['drives'][number]) => unknown
) {
  const machine = current();
  const set = machine.drives.find((one) => one.letter === letter);

  if (set) {
    status(String(await act(machine, set)));
  }
}

/** A machine by its number. */
const machineAt = (id: number) => machines.find((one) => one.id === id && !one.closed);

export const actions = {
  /** Files dropped on the page's drop, or on a drive's row (`letter`). */
  drop: (transfer: DataTransfer | null, letter: string | null = null) => dropped(transfer, letter),

  /** Files chosen with the page's own picker. */
  choose: (files: File[]) => accept(files),

  /** Images chosen to add as drives, or to a drive's set (`into`): `input` where the browser has no picker of handles. */
  chooseImages: (input: HTMLInputElement, into: string | null = null) => chooseImages(input, into),

  /** Images chosen with the page's own file input, as drives, or to a drive's set. */
  imagesChosen: (files: File[], into: string | null = null) =>
    accept(files, { drives: true, into }),

  /** A machine's tab chosen: its screen shown, and the side and the trace speaking for it. */
  select(id: number) {
    const machine = machineAt(id);

    if (machine && machine !== current()) {
      select(machine);
    }
  },

  /**
   * A machine's tab closed: what its programs wrote kept first, then the
   * machine ended (`closeMachine`). Nothing is lost, so nothing is asked.
   */
  async close(id: number) {
    const machine = machineAt(id);

    if (machine) {
      await closeMachine(machine);
    }
  },

  /**
   * The display chosen for the machine shown: made afresh on it. An
   * installer runs on the display it was started on, and is let go of.
   */
  setDisplay(display: string) {
    const machine = current();
    const was = machine.display;

    return remake(machine, () => {
      machine.display = display;
      return () => (machine.display = was);
    });
  },

  /**
   * The mode chosen for the machine shown, standard or 386 enhanced: made
   * afresh in it, as for a display. A kept program runs in its install's
   * mode, so a machine in another runs the base; an install made on it
   * keeps the mode it ran in (`kb/guides/enhanced-mode.md`).
   */
  setMode(mode: WindowsMode) {
    const machine = current();
    const was = machine.mode;

    return remake(machine, () => {
      machine.mode = mode;
      return () => (machine.mode = was);
    });
  },

  setCoprocessor(on: boolean) {
    const machine = current();

    machine.coprocessor = on;
    publish();
    rebuild(machine);
  },

  /* Only the Rust engine has a sound card to give a machine. Windows reads
   * SYSTEM.INI as it starts, and stays up from one program to the next, so
   * the card is a setting of the machine, as the display and the
   * coprocessor are: changed, the machine is made afresh, and its first
   * program starts Windows with the card or without it. */
  async setSound(on: boolean) {
    const machine = current();

    machine.sound = on;
    publish();
    (await machine.engine).sound = on;
    rebuild(machine);
  },

  /** Copies of a kept program's images kept, where asked for. */
  setKeepImages(on: boolean) {
    const machine = current();

    state.keepImages = on;
    publish();

    const program = programOf(machine);

    if (program) {
      rememberImages(machine, program);
    }
  },

  setInstallInto(into: string) {
    state.installInto = into;
    publish();
  },

  run: (program: Program) => run(current(), program),

  /** A group's item chosen in the launcher's menu, run on its install's machine as Program Manager runs it. */
  launch: (install: string, group: number, item: number) => launch(install, group, item),

  /** The file browser opened on a drive's folder of the machine shown: its root, C:'s by default. */
  browse: (letter = 'C', parts: string[] = []) => browse(letter, parts),
  install: () => install(),
  keepAsProgram: () => keepAsProgram(),
  keepInstalled: () => keepInstalled(),
  discardInstall: () => discardInstall(),

  /** A kept program opened: the machine running it shown, or a machine of its own made. */
  open: (name: string) => open(name),
  forgetProgram: (name: string) => forgetKept(name),

  insertDisk: (letter: string, disk: number) =>
    said(letter, (machine) => insertDisk(machine, letter, disk)),
  nextDisk: (letter: string) => said(letter, nextDisk),
  ejectDisk: (letter: string) => said(letter, ejectDisk),
  saveImage: (letter: string) => said(letter, saveImage),
  removeDrive: (letter: string) => said(letter, removeDrive),
  installFromDrive: (letter: string, installer: Program) =>
    said(letter, (machine, set) => offerDrive(machine, set, installer)),

  /**
   * What programs wrote was written on the installation, or the bundle's
   * base, and goes with it: every machine but the one shown closed, what
   * they wrote not kept, and that one made afresh with no Windows.
   */
  async forgetWindows() {
    const machine = current();

    for (const other of machines.filter((one) => one !== machine)) {
      await closeMachine(other, { keeping: false });
    }

    await hold(machine, { keeping: false });

    const what = state.windows ? 'the Windows installation' : 'the asset bundle';
    const had = state.programs.length;

    await forgetPrograms();
    state.windows = null;
    state.installation = null;
    state.assets = null;
    state.media = [];
    machine.kept = { installation: null, changes: [] };
    machine.tooLarge = [];
    await Promise.all([forgetWindowsKept(), forgetAssets(), forgetAllChanges()]);
    offerDisplays();

    if (await rebuild(machine, { keeping: false })) {
      status(
        had
          ? `Forgot ${what}, the programs kept on it, and what programs wrote.`
          : `Forgot ${what}, and what programs wrote.`
      );
    }
  },

  /** What the machine shown's programs wrote forgotten. */
  async forgetChanges() {
    const machine = current();

    await hold(machine, { keeping: false });

    const identity = identityOf(machine);

    machine.kept = { installation: identity, changes: [] };
    machine.tooLarge = [];
    await forgetChangesKept(identity);

    if (await rebuild(machine, { keeping: false })) {
      status('Forgot what programs wrote.');
    }
  },

  /** The other engine's page, once what every machine wrote is kept. */
  async switchEngine(href: string) {
    await Promise.all(machines.map((machine) => keepAll(machine)));
    location.assign(href);
  },
};

export type Actions = typeof actions;

let started = false;

/**
 * The page started, its machines' screens to go in `desktop`: what was
 * remembered in this browser read back and a machine made from it, on the
 * base, and what every machine's programs write kept while the page is
 * shown, and as it is hidden or left. Once.
 */
export function start(desktop: HTMLElement) {
  session.desktop = desktop;

  /* The machines' screens, where the desktop is rendered again. */
  for (const machine of machines) {
    if (machine.desktop.parentElement !== desktop) {
      desktop.append(machine.desktop);
    }
  }

  if (started) {
    return;
  }

  started = true;
  offerDisplays();

  const first = addMachine();

  select(first);

  /* Kept while the page is shown, and as it is hidden or left. */
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      keepEvery();
    }
  }, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      keepEvery();
    }
  });
  addEventListener('pagehide', () => keepEvery());

  Promise.all([recallWindows(), recallAssets(), recallPrograms()]).then(
    async ([remembered, bundle, programs]) => {
      let note: string | null = null;

      state.programs = programs;

      if (remembered) {
        state.windows = { name: remembered.name, entries: await readZip(remembered.bytes) };
        state.installation = await identify(remembered);
      } else if (bundle) {
        try {
          state.assets = await Assets.fromZip(bundle.bytes);
        } catch (error: any) {
          note = `The asset bundle kept could not be read: ${error?.message ?? error}`;
        }
      }

      offerDisplays();

      /* What was kept is put back only on what it was written on. */
      const identity = identityOf(first);

      first.kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };

      if (await rebuild(first, { keeping: false })) {
        status(
          note ??
            (remembered
              ? `Remembered ${remembered.name}.`
              : state.assets
                ? 'Remembered the asset bundle.'
                : 'Ready.'),
          note ? 'error' : 'info'
        );
      }
    }
  );

  /* Handy for prodding the machines from the browser console: the
   * machine shown's, as `engine`, `plan`, `session` and `kept`. */
  Object.assign(globalThis as Record<string, unknown>, {
    winbox: {
      state,
      machines,
      get machine() {
        return current();
      },
      get plan() {
        return current()?.plan;
      },
      get engine() {
        return current()?.made;
      },
      get session() {
        return current()?.made?.session;
      },
      get kept() {
        return current()?.kept;
      },
      keptCounts,
      imageCounts,
      keep: () => keepAll(current()),
      keepEvery,
      accept,
      run: (program: Program) => run(current(), program),
    },
  });
}
