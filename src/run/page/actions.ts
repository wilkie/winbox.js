/**
 * What the run page's controls do: the actions its components call, each
 * changing the state (`state.ts`) through the modules beside this one and
 * publishing what is to be shown; and the page started, once its desktop is
 * there for the engine's screen.
 */

import { readZip } from '../../zip.js';
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
import { ejectDisk, insertDisk, nextDisk, offerDrive, removeDrive, saveImage } from './images.js';
import { rememberImages } from './images.js';
import {
  choose,
  discardInstall,
  forgetKept,
  install,
  keepAsProgram,
  keepInstalled,
} from './install.js';
import { engine, EVERY, hold, keep, keepAll, offerDisplays, rebuild, run } from './machine.js';
import { identityNow, programNow, publish, session, state, status } from './state.js';

/** A drive's set by its letter. */
const driveAt = (letter: string) => state.drives.find((one) => one.letter === letter);

/** What a drive's action says, said on the status line. */
async function said(letter: string, act: (set: (typeof state.drives)[number]) => unknown) {
  const set = driveAt(letter);

  if (set) {
    status(String(await act(set)));
  }
}

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

  /** The display chosen: the machine made afresh on it. An installer runs on the display it was started on. */
  setDisplay(display: string) {
    state.display = display;
    state.installing = null;
    publish();
    rebuild();
  },

  setCoprocessor(on: boolean) {
    state.coprocessor = on;
    publish();
    rebuild();
  },

  /* Only the Rust engine has a sound card to give a machine. Windows reads
   * SYSTEM.INI as it starts, and stays up from one program to the next, so
   * the card is a setting of the machine, as the display and the
   * coprocessor are: changed, the machine is made afresh, and its first
   * program starts Windows with the card or without it. */
  async setSound(on: boolean) {
    state.sound = on;
    publish();
    (await engine).sound = on;
    rebuild();
  },

  /** Copies of a kept program's images kept, where asked for. */
  setKeepImages(on: boolean) {
    state.keepImages = on;
    publish();

    const program = programNow();

    if (program) {
      rememberImages(program);
    }
  },

  setInstallInto(into: string) {
    state.installInto = into;
    publish();
  },

  run: (program: Program) => run(program),
  install: () => install(),
  keepAsProgram: () => keepAsProgram(),
  keepInstalled: () => keepInstalled(),
  discardInstall: () => discardInstall(),

  /** A kept program put on C:, or taken off it (`null`). */
  open: (name: string | null) => choose(name),
  forgetProgram: (name: string) => forgetKept(name),

  insertDisk: (letter: string, disk: number) => said(letter, () => insertDisk(letter, disk)),
  nextDisk: (letter: string) => said(letter, nextDisk),
  ejectDisk: (letter: string) => said(letter, ejectDisk),
  saveImage: (letter: string) => said(letter, saveImage),
  removeDrive: (letter: string) => said(letter, removeDrive),
  installFromDrive: (letter: string, installer: Program) =>
    said(letter, (set) => offerDrive(set, installer)),

  /** What programs wrote was written on the installation, or the bundle's base, and goes with it. */
  async forgetWindows() {
    await hold({ keeping: false });

    const what = state.windows ? 'the Windows installation' : 'the asset bundle';
    const had = state.programs.length;

    await forgetPrograms();
    state.windows = null;
    state.installation = null;
    state.assets = null;
    state.media = [];
    session.kept = { installation: null, changes: [] };
    session.tooLarge = [];
    await Promise.all([forgetWindowsKept(), forgetAssets(), forgetAllChanges()]);
    offerDisplays();

    if (await rebuild({ keeping: false })) {
      status(
        had
          ? `Forgot ${what}, the programs kept on it, and what programs wrote.`
          : `Forgot ${what}, and what programs wrote.`
      );
    }
  },

  async forgetChanges() {
    await hold({ keeping: false });

    const identity = identityNow();

    session.kept = { installation: identity, changes: [] };
    session.tooLarge = [];
    await forgetChangesKept(identity);

    if (await rebuild({ keeping: false })) {
      status('Forgot what programs wrote.');
    }
  },

  /** The other engine's page, once what the machine wrote is kept. */
  async switchEngine(href: string) {
    await keepAll();
    location.assign(href);
  },
};

export type Actions = typeof actions;

let started = false;

/**
 * The page started, its screen to go in `desktop`: what was remembered in
 * this browser read back and the machine made from it, and what programs
 * write kept while the page is shown, and as it is hidden or left. Once.
 */
export function start(desktop: HTMLElement) {
  session.desktop = desktop;

  if (started) {
    return;
  }

  started = true;
  offerDisplays();
  state.display = 'vga';
  publish();

  /* Kept while the page is shown, and as it is hidden or left. */
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      keep();
    }
  }, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      keep();
    }
  });
  addEventListener('pagehide', () => keep());

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
      const identity = identityNow();

      session.kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };

      if (await rebuild({ keeping: false })) {
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

  /* Handy for prodding the machine from the browser console. */
  Object.assign(globalThis as Record<string, unknown>, {
    winbox: {
      state,
      get plan() {
        return session.plan;
      },
      get engine() {
        return session.made;
      },
      get session() {
        return session.made?.session;
      },
      get kept() {
        return session.kept;
      },
      keptCounts,
      imageCounts,
      keep: keepAll,
      accept,
      run,
    },
  });
}
