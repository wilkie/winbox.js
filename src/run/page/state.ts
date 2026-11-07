/**
 * The run page's state: what has been dropped, what is kept, the machines
 * -- each a Windows of its own, a tab of the page, with its drives and the
 * install under way on it -- and the settings the page's controls hold; and
 * what it shows of them, published for the components (`publish`).
 *
 * The page's actions (`machine.ts`, `accept.ts`, `images.ts`, `install.ts`,
 * `actions.ts`) change this and publish; the components (`../ui/`) read what
 * is published and call the actions. No React here, nor any rendering.
 */

import { type Assets } from '../../assets/bundle.js';
import { type AssetInput } from '../../assets/make.js';
import { baseName, type Layer } from '../../layers/layer.js';
import { type Change } from '../changes.js';
import { type Archive, type Plan, type Program } from '../drive.js';
import { type DriveSet, imageKey, type Wanting } from '../drives.js';
import { type Engine } from '../engines/engine.js';
import { type WindowsMode } from '../../emulator/machine.js';
import { installerOf } from '../media.js';
import {
  assetsIdentity,
  changesKey,
  type Kept,
  type KeptProgram,
  modeOfProgram,
  programIdentity,
} from '../store.js';
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
  type Installing,
  installView,
  KEPT_NOTE,
  keptRows,
  MODES,
  launcherView,
  keptText,
  type MachineFacts,
  machineName,
  type Needed,
  neededRows,
  type PageView,
  programRows,
  tabsView,
  traceRows,
  type TraceRow,
  windowsText,
} from './view.js';

/**
 * What has been dropped: program archives, and at most one Windows -- an
 * installation, with what tells it apart (`identify`), or an asset bundle --
 * and the media dropped since the page was opened, which media dropped
 * after are added to: the Super VGA driver's files after the disks. With
 * them, what the page's controls hold that is the page's, not a machine's.
 */
export const state: {
  archives: Archive[];
  windows: Archive | null;
  installation: string | null;
  assets: Assets | null;
  media: AssetInput[];
  programs: KeptProgram[];
  offer: Archive | null;
  needed: Needed[];

  /** The displays offered (`offerDisplays`). */
  displays: string[];

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
  offer: null,
  needed: [],
  displays: [],
  keepImages: false,
  installInto: '',
};

/** What the page's actions share beside the state and the machines. */
export const session: {
  /** Which engine runs the programs, and whether the Rust engine was wanted but not there. */
  rust: boolean;
  unbuilt: boolean;

  /**
   * Cue sheets dropped or chosen whose files are not all had yet, asked for
   * by name and taken from the files dropped or chosen next.
   */
  wanting: Wanting[];

  /** Where the machines' screens go: the components' desktop, once it is there. */
  desktop: HTMLElement | null;
} = {
  rust: false,
  unbuilt: false,
  wanting: [],
  desktop: null,
};

/**
 * A machine (`kb/guides/launcher.md`, design A): a Windows of its own, on
 * an engine instance of its own, its own C: -- a kept program's stack, or
 * the base with what was dropped loose -- its own drives of images, its
 * screen, its trace, and its keeping of what its programs write. Each is a
 * tab of the page; the side's panels and the trace speak for the one
 * shown (`current`).
 */
export interface Machine {
  /** Its number, which its tab and screen are named by. */
  readonly id: number;

  /** The kept program whose stack it runs, while the Windows and the display it was made on are; else the base alone. */
  program: string | null;

  /** Its display, the mode Windows runs in, its coprocessor and sound card. */
  display: string;
  mode: WindowsMode;
  coprocessor: boolean;
  sound: boolean;

  /** The install under way on it. */
  installing: Installing | null;

  /** An installer on one of its drives offered to install. */
  driveOffer: DriveOffer | null;

  /** Its drives of images, by their letters, and what the page read of each disk in them. */
  readonly drives: DriveSet[];
  readonly drivePrograms: Map<string, Program[]>;
  readonly driveVolumes: Map<string, string | null>;

  /** The engine, as it is being made, and once it is. */
  engine: Promise<Engine>;
  made: Engine | null;

  /** What the machine as last made was told against, and so what its changes are kept against. */
  built: string | null;

  /** Where everything dropped is on C:, as the engine's machine was last made from. */
  plan: Plan | null;

  /** What programs wrote on C:, as it was last kept, against the installation dropped. */
  kept: Kept;

  /** What was put back on C: as the machine was last made: the changes of before, which the file browser tells apart. */
  given: Change[];

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

  /** Whether it has been closed: its engine ended, nothing more kept of it. */
  closed: boolean;

  /** Where its engine puts its screen: an element of its own in the desktop, hidden while another is shown. */
  readonly desktop: HTMLElement;

  /** Its trace: the functions called and how often, and the most recent calls; and the frame asked for to show them. */
  readonly counts: Map<string, { count: number; stub: boolean }>;
  readonly recent: string[];
  traceFrame: number;
}

/** The machines, in the order of their tabs. */
export const machines: Machine[] = [];

/** The machine shown: whose tab is selected, and whom the side's panels and the trace speak for. */
let shown: Machine | null = null;

/** The machine shown; the first where none is chosen. */
export function current(): Machine {
  return shown && !shown.closed ? shown : machines[0];
}

/** The machine shown chosen, without publishing. */
export function show(machine: Machine | null) {
  shown = machine;
}

/**
 * The programs kept in this browser, each a stack of its own
 * (`kb/formats/layer.md`): the base and its layers, the lowest first.
 * What was dropped as an archive is laid at `C:\<NAME>` as before, and
 * kept as a layer. A machine's `program` is the one it runs, whose stack
 * C: is while the Windows and the display it was made on are; else C: is
 * the base alone, with the archives dropped loose on it -- the "loose
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

/** The keys of the images had on this visit from a copy kept in this browser (`mountMedia`). */
export const copies = new Set<string>();

/** The display a machine is made on where nothing says otherwise. */
export const FIRST_DISPLAY = 'vga';

/** The base C: is on a display: its name as a stack names it, or null with no Windows. */
export function baseNow(display = current()?.display ?? FIRST_DISPLAY) {
  return state.windows && state.installation
    ? `install:${state.installation}`
    : state.assets
      ? baseName(state.assets.id, display)
      : null;
}

/** The program a machine runs, where it was made on the base and display the machine is on. */
export function programOf(machine: Machine | undefined = current()) {
  const program = machine && state.programs.find((one) => one.name === machine.program);

  return program &&
    program.base === baseNow(machine.display) &&
    program.display === machine.display &&
    modeOfProgram(program) === machine.mode
    ? program
    : null;
}

/** The program the machine shown runs. */
export const programNow = () => programOf(current());

/**
 * What the changes a machine's programs write are told against: its
 * program's stack (`programIdentity`); else the installation, or the asset
 * bundle and the display, whose base differs with the display
 * (`assetsIdentity`); null with neither.
 */
export function identityOf(machine: Machine) {
  const program = programOf(machine);

  if (program) {
    return programIdentity(program.name, program.base, program.display, program.layers);
  }

  return !state.windows && state.assets
    ? assetsIdentity(state.assets.id, machine.display)
    : state.installation;
}

/** What the machine shown's changes are told against. */
export const identityNow = () => identityOf(current());

/**
 * The machine, but `but`, already running the stack `identity` names,
 * where one does: no two machines keep what they write in the one place
 * (`changesKey`), as each would put its own over the other's.
 */
export function runningOn(identity: string | null, but: Machine | null = null) {
  const key = changesKey(identity);

  return (
    machines.find(
      (machine) =>
        machine !== but &&
        !machine.closed &&
        !machine.installing &&
        changesKey(identityOf(machine)) === key
    ) ?? null
  );
}

/** The machine running a kept program, where one does. */
export const machineOf = (name: string) =>
  machines.find(
    (machine) => !machine.closed && !machine.installing && programOf(machine)?.name === name
  ) ?? null;

/** The kept programs an installer on a machine may install into: those of the base and display it is on. */
export function programsHere(machine: Machine = current()) {
  const base = baseNow(machine.display);

  return state.programs.filter(
    (program) =>
      program.base === base &&
      program.display === machine.display &&
      modeOfProgram(program) === machine.mode
  );
}

/** A machine's facts, as its tab names it (`machineName`). */
export const factsOf = (machine: Machine): MachineFacts => ({
  id: machine.id,
  program: programOf(machine)?.name ?? null,
  installing: machine.installing?.name ?? null,
  display: machine.display,
  windows: Boolean(baseNow(machine.display)),
});

/** A machine's name, as its tab shows it. */
export const nameOf = (machine: Machine) => machineName(factsOf(machine));

/* ---- what is published ---- */

/** A line the status shows: its words, whether it tells of an error, and its number, counted up with each. */
export interface StatusLine {
  message: string;
  kind: 'info' | 'error';
  seq: number;
}

export const statusLine = new Observable<StatusLine>({ message: 'Loading…', kind: 'info', seq: 0 });

/**
 * The status line told: each line its own, the same words again among
 * them. The page has one status line; a line a machine not shown tells
 * is named with its machine's name, for it to be told apart from the
 * machine shown's.
 */
export function status(message: string, kind: 'info' | 'error' = 'info', from?: Machine) {
  const named =
    from && from !== current() && !from.closed ? `${nameOf(from)}: ${message}` : message;

  statusLine.set({ message: named, kind, seq: statusLine.get().seq + 1 });
}

/** The trace of the machine shown: the functions called and how often, and the most recent calls. */
export const traceView = new Observable<{ rows: TraceRow[]; recent: string }>({
  rows: [],
  recent: '',
});

/** The trace of the machine shown published as it stands. */
export function publishTrace() {
  const machine = current();

  traceView.set({
    rows: machine ? traceRows(machine.counts) : [],
    recent: machine ? machine.recent.join('\n') : '',
  });
}

/** What the page shows, as it was last published. */
export const pageView = new Observable<PageView | null>(null);

/**
 * What the page shows made afresh from the state and published, as each of
 * the page's old `render` functions drew it, the side's panels speaking for
 * the machine shown. The program to install into is kept where it is still
 * offered, as the select kept its value.
 */
export function publish() {
  const machine = current();

  if (!machine) {
    return;
  }

  const base = baseNow(machine.display);
  const groupsOf = (program: KeptProgram) => keptGroups(program, state, publish);
  const chosen = programOf(machine);
  const { plan } = machine;
  const install = installView(
    state.offer,
    state.offer ? installerOf(state.offer.entries) : null,
    machine.driveOffer,
    machine.installing,
    programsHere(machine),
    state.programs,
    state.installInto
  );

  if (install.options.length) {
    state.installInto = install.into;
  }

  const programs = programRows(
    plan,
    machine.drives.flatMap((set) => machine.drivePrograms.get(set.letter) ?? []),
    Boolean(state.archives.length || chosen)
  );

  pageView.set({
    engine: engineView(session.rust, session.unbuilt),
    soundOffered: session.rust,
    windows: windowsText(state.windows, state.assets, plan),
    forgettable: Boolean(state.windows || state.assets),
    changes: changesView(machine.kept.changes, machine.tooLarge),
    displays: state.displays.map((name) => ({ value: name, text: displayName(name) })),
    display: machine.display,
    modes: MODES,
    mode: machine.mode,
    coprocessor: machine.coprocessor,
    sound: machine.sound,
    keepImages: state.keepImages,
    drivesNote: drivesNote(machine.drives.length > 0),
    c: cDriveView(
      state.windows,
      state.assets,
      machine.display,
      chosen,
      chosen ? 0 : state.archives.length,
      machine.kept.changes.length
    ),
    drives: driveRows(
      machine.drives,
      (letter) => machine.drivePrograms.get(letter) ?? [],
      base,
      Boolean(machine.installing),
      {
        written: (letter, disk) => machine.made?.diskChanged(letter, disk) ?? false,
        volume: (letter) => machine.driveVolumes.get(letter) ?? null,
        kept: (disk) => {
          const key = imageKey(disk.name, disk.size, disk.modified);

          return chosen ? keptText(handles.has(key), state.keepImages || copies.has(key)) : null;
        },
        program: chosen?.name ?? null,
      }
    ),
    needed: neededRows(state.needed, session.wanting),
    kept: keptRows(
      state.programs,
      (name) => {
        const running = machineOf(name);

        return running === machine ? 'shown' : running ? 'behind' : null;
      },
      (display) => baseNow(display),
      state.displays,
      machine.display,
      groupsOf,
      machine.mode
    ),
    keptNote: KEPT_NOTE,
    launcher: launcherView(state.programs, groupsOf, state.displays),
    install,
    programs: programs.rows,
    programsEmpty: programs.empty,
    tabs: tabsView(machines.filter((one) => !one.closed).map(factsOf), machine.id),
  });
}
