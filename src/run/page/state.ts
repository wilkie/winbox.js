/**
 * The run page's state: what has been dropped, what is kept, the drives,
 * the install under way, and the settings the page's controls hold -- and
 * what it shows of them, published for the components (`publish`).
 *
 * The page's actions (`machine.ts`, `accept.ts`, `drives.ts`, `install.ts`,
 * `actions.ts`) change this and publish; the components (`../ui/`) read what
 * is published and call the actions. No React here, nor any rendering.
 */

import { type Assets } from '../../assets/bundle.js';
import { type AssetInput } from '../../assets/make.js';
import { baseName, type Layer } from '../../layers/layer.js';
import { type Archive, type Plan, type Program } from '../drive.js';
import { type DriveSet, imageKey, type Wanting } from '../drives.js';
import { type Engine } from '../engines/engine.js';
import { installerOf } from '../media.js';
import { assetsIdentity, type Kept, type KeptProgram, programIdentity } from '../store.js';
import { keptGroups } from './groups.js';
import { Observable } from './observable.js';
import {
  cDriveView,
  changesView,
  displayName,
  type DriveOffer,
  driveRows,
  drivesNote,
  engineView,
  fileRows,
  type Installing,
  installView,
  KEPT_NOTE,
  keptRows,
  keptText,
  type Needed,
  neededRows,
  type PageView,
  programRows,
  traceRows,
  type TraceRow,
  windowsText,
} from './view.js';

/**
 * What has been dropped: program archives, and at most one Windows -- an
 * installation, with what tells it apart (`identify`), or an asset bundle --
 * and the media dropped since the page was opened, which media dropped
 * after are added to: the Super VGA driver's files after the disks. With
 * them, what the page's controls hold.
 */
export const state: {
  archives: Archive[];
  windows: Archive | null;
  installation: string | null;
  assets: Assets | null;
  media: AssetInput[];
  programs: KeptProgram[];
  program: string | null;
  offer: Archive | null;
  driveOffer: DriveOffer | null;
  installing: Installing | null;
  drives: DriveSet[];
  needed: Needed[];

  /** The displays offered (`offerDisplays`), and the one chosen. */
  displays: string[];
  display: string;
  coprocessor: boolean;
  sound: boolean;

  /** Whether copies of a kept program's images are kept, not only handles on them. */
  keepImages: boolean;

  /** The kept program an installer is to install into; `''` for one of its own. */
  installInto: string;
} = {
  archives: [],
  windows: null,
  installation: null,
  assets: null,
  media: [],
  programs: [],
  program: null,
  offer: null,
  driveOffer: null,
  installing: null,
  drives: [],
  needed: [],
  displays: [],
  display: 'vga',
  coprocessor: true,
  sound: false,
  keepImages: false,
  installInto: '',
};

/** What the page's actions share beside the state: the machine, and what was kept of it. */
export const session: {
  /** The engine, once it is made. */
  made: Engine | null;

  /** Which engine runs the programs, and whether the Rust engine was wanted but not there. */
  rust: boolean;
  unbuilt: boolean;

  /** What the machine as last made was told against, and so what its changes are kept against. */
  built: string | null;

  /** Where everything dropped is on C:, as the engine's machine was last made from. */
  plan: Plan | null;

  /** What programs wrote on C:, as it was last kept, against the installation dropped. */
  kept: Kept;

  /** The files too large to keep, as the last were told. */
  tooLarge: string[];

  /**
   * Counted up whenever the machine is made afresh, or what was kept is
   * forgotten: changes told by a machine since gone are not kept.
   */
  generation: number;

  /** Whether the machine is being made afresh, when it has no changes to tell. */
  rebuilding: boolean;

  /** The keeping under way, which another waits for rather than racing it. */
  keeping: Promise<void> | null;

  /**
   * Cue sheets dropped or chosen whose files are not all had yet, asked for
   * by name and taken from the files dropped or chosen next.
   */
  wanting: Wanting[];

  /** Where the engine puts the screen: the components' desktop, once it is there. */
  desktop: HTMLElement | null;
} = {
  made: null,
  rust: false,
  unbuilt: false,
  built: null,
  plan: null,
  kept: { installation: null, changes: [] },
  tooLarge: [],
  generation: 0,
  rebuilding: false,
  keeping: null,
  wanting: [],
  desktop: null,
};

/**
 * The programs kept in this browser, each a stack of its own
 * (`kb/formats/layer.md`): the base and its layers, the lowest first.
 * What was dropped as an archive is laid at `C:\<NAME>` as before, and
 * kept as a layer. `state.program` is the one chosen, whose stack C: is
 * while the Windows and the display it was made on are; else C: is the
 * base alone, with the archives dropped loose on it -- the "loose
 * programs" stack, whose changes are kept as they were before programs
 * were kept. Each kept program's layers, read back once.
 */
export const stacks = new Map<string, Layer[]>();

/**
 * Handles on the images' files, by their keys (`imageKey`), where the
 * browser gave one -- a File System Access handle, Chromium's -- for a kept
 * program to remember (`rememberImages`) rather than a copy of the file.
 */
export const handles = new Map<string, unknown>();

/** The Windows programs on each drive's disk, by its letter, as the page read them (`programsOn`). */
export const drivePrograms = new Map<string, Program[]>();

/** Each drive's volume label, by its letter, as the page read its disk: a disc's; null for none. */
export const driveVolumes = new Map<string, string | null>();

/** The keys of the images had on this visit from a copy kept in this browser (`mountMedia`). */
export const copies = new Set<string>();

/** The base C: is now: its name as a stack names it, or null with no Windows. */
export function baseNow() {
  return state.windows && state.installation
    ? `install:${state.installation}`
    : state.assets
      ? baseName(state.assets.id, state.display)
      : null;
}

/** The program chosen, where it was made on the base and display C: is now. */
export function programNow() {
  const program = state.programs.find((one) => one.name === state.program);

  return program && program.base === baseNow() && program.display === state.display
    ? program
    : null;
}

/**
 * What the changes programs write are told against: the program chosen's
 * stack (`programIdentity`); else the installation, or the asset bundle
 * and the display, whose base differs with the display (`assetsIdentity`);
 * null with neither.
 */
export function identityNow() {
  const program = programNow();

  if (program) {
    return programIdentity(program.name, program.base, program.display, program.layers);
  }

  return !state.windows && state.assets
    ? assetsIdentity(state.assets.id, state.display)
    : state.installation;
}

/** The kept programs an installer may install into: those of the base and display C: is now. */
export function programsHere() {
  const base = baseNow();

  return state.programs.filter(
    (program) => program.base === base && program.display === state.display
  );
}

/* ---- what is published ---- */

/** A line the status shows: its words, whether it tells of an error, and its number, counted up with each. */
export interface StatusLine {
  message: string;
  kind: 'info' | 'error';
  seq: number;
}

export const statusLine = new Observable<StatusLine>({ message: 'Loading…', kind: 'info', seq: 0 });

/** The status line told: each line its own, the same words again among them. */
export function status(message: string, kind: 'info' | 'error' = 'info') {
  statusLine.set({ message, kind, seq: statusLine.get().seq + 1 });
}

/** The trace: the functions called and how often, and the most recent calls. */
export const counts = new Map<string, { count: number; stub: boolean }>();
export const recent: string[] = [];

export const traceView = new Observable<{ rows: TraceRow[]; recent: string }>({
  rows: [],
  recent: '',
});

/** The trace published as it stands. */
export function publishTrace() {
  traceView.set({ rows: traceRows(counts), recent: recent.join('\n') });
}

/** What the page shows, as it was last published. */
export const pageView = new Observable<PageView | null>(null);

/**
 * What the page shows made afresh from the state and published, as each of
 * the page's old `render` functions drew it. The program to install into is
 * kept where it is still offered, as the select kept its value.
 */
export function publish() {
  const base = baseNow();
  const chosen = programNow();
  const { plan } = session;
  const install = installView(
    state.offer,
    state.offer ? installerOf(state.offer.entries) : null,
    state.driveOffer,
    state.installing,
    programsHere(),
    state.programs,
    state.installInto
  );

  if (install.options.length) {
    state.installInto = install.into;
  }

  const programs = programRows(
    plan,
    state.drives.flatMap((set) => drivePrograms.get(set.letter) ?? []),
    Boolean(state.archives.length || chosen)
  );

  pageView.set({
    engine: engineView(session.rust, session.unbuilt),
    soundOffered: session.rust,
    windows: windowsText(state.windows, state.assets, plan),
    forgettable: Boolean(state.windows || state.assets),
    changes: changesView(session.kept.changes, session.tooLarge),
    displays: state.displays.map((name) => ({ value: name, text: displayName(name) })),
    display: state.display,
    coprocessor: state.coprocessor,
    sound: state.sound,
    keepImages: state.keepImages,
    drivesNote: drivesNote(state.drives.length > 0),
    c: cDriveView(
      state.windows,
      state.assets,
      state.display,
      chosen,
      chosen ? 0 : state.archives.length,
      session.kept.changes.length
    ),
    drives: driveRows(
      state.drives,
      (letter) => drivePrograms.get(letter) ?? [],
      base,
      Boolean(state.installing),
      {
        written: (letter, disk) => session.made?.diskChanged(letter, disk) ?? false,
        volume: (letter) => driveVolumes.get(letter) ?? null,
        kept: (disk) => {
          const key = imageKey(disk.name, disk.size, disk.modified);

          return chosen ? keptText(handles.has(key), state.keepImages || copies.has(key)) : null;
        },
        program: chosen?.name ?? null,
      }
    ),
    needed: neededRows(state.needed, session.wanting),
    kept: keptRows(state.programs, chosen, base, state.display, (program) =>
      keptGroups(program, publish)
    ),
    keptNote: KEPT_NOTE,
    install,
    programs: programs.rows,
    programsEmpty: programs.empty,
    files: fileRows(plan),
  });
}
