/**
 * What the run page shows, as plain data: each panel's rows and words, made
 * from the page's state (`state.ts`) by the functions here, which read it and
 * change nothing. The components (`../ui/`) render this and nothing else, and
 * call the page's actions (`actions.ts`); a launcher's view, later, is another
 * set of components over the same.
 *
 * No React here, nor the DOM: these are tested from jest
 * (`test/run/page_view_test.ts`).
 */

import { type Assets } from '../../assets/bundle.js';
import { type Change } from '../changes.js';
import { type Archive, type Plan, type Program } from '../drive.js';
import {
  type Disk,
  type DriveSet,
  installerOn,
  missingOf,
  setText,
  type Wanting,
} from '../drives.js';
import { type KeptProgram, type Medium } from '../store.js';
import { type StackGroup } from '../../layers/groups.js';
import { DISPLAY_MODES } from '../../win16/display-modes.js';

/**
 * An installer on a drive of images offered to install
 * (`kb/formats/layer.md`, "Media on another drive"): run from its floppy
 * or disc, nothing of its media put on C:.
 */
export interface DriveOffer {
  letter: string;
  installer: Program;

  /** The program's name: its first image's, without its extension. */
  name: string;
}

/**
 * A program's installer running over a stack (`kb/formats/layer.md`): its
 * archive put on C: as its media, at `C:\WBSETUP`, over the stack of the
 * kept program it installs into, or the base alone, with nothing written
 * on it yet; until it is kept as a layer, or let go of.
 */
export interface Installing {
  /** The program's name: its archive's, or the program it installs into. */
  name: string;

  /** The archive dropped, as it was named. */
  from: string;

  /** The media, as `planDrive` lays them: the archive named for their folder; none for an installer run from a drive of images. */
  media: Archive | null;

  /** The drive of images it runs from, `A`; none for one whose media are at `C:\WBSETUP`. */
  drive: string | null;

  /** Its installer, where the plan puts it: `C:\WBSETUP\SETUP.EXE`, or on its drive: `A:\SETUP.EXE`. */
  installer: string;

  /** The kept program it installs into, in turn; none for a program of its own. */
  into: string | null;

  /** Whether its task has ended, so that what it wrote may be kept. */
  ended: boolean;
}

/** An image a kept program is run with, not yet had on this visit: asked for again by its name. */
export interface Needed extends Medium {
  /** The kept program that wants it. */
  program: string;

  /** Its bytes, once had; its set is mounted when every one of it is. */
  disk: Disk | null;

  /** A cue sheet's own file once had, and the files it names had so far, in its order (`tracks`). */
  have?: Disk | null;
  trackDisks?: (Disk | null)[];
}

/**
 * Where an installer's media are put on C: while it runs: a folder of
 * their own, which no installer installs into, so that what it installed
 * is never taken for its media (`kb/formats/layer.md`, "Installing on the
 * page").
 */
export const MEDIA = 'WBSETUP';

/** A display's name as the page shows it: its description. */
export function displayName(name: string) {
  return (DISPLAY_MODES as any)[name]?.description ?? name;
}

/**
 * The displays offered: those the asset bundle has a driver and a base for,
 * where C: is its base; every one, else (`composed`: those the asset maker
 * composes a base for).
 */
export function offeredDisplays(
  windows: Archive | null,
  assets: Pick<Assets, 'displays'> | null,
  composed: string[]
) {
  return Object.keys(DISPLAY_MODES).filter(
    (name) => windows || !assets || (assets.displays.includes(name) && composed.includes(name))
  );
}

/** The display chosen kept where it is offered, VGA else, or the first. */
export function displayKept(names: string[], chosen: string) {
  return names.includes(chosen) ? chosen : names.includes('vga') ? 'vga' : (names[0] ?? '');
}

/** What the page has of Windows, said. */
export function windowsText(
  windows: Archive | null,
  assets: Pick<Assets, 'manifest'> | null,
  plan: Pick<Plan, 'windows'> | null
) {
  if (windows) {
    return `Windows installation: ${windows.name}${plan?.windows ? '' : ' (no SYSTEM fonts found in it)'}`;
  }

  if (assets) {
    const { manifest } = assets;
    const unknown = manifest.sources.filter((source) => !source.known).length;

    return (
      `Windows 3.1 from your setup disks: the asset bundle ${manifest.id.slice(0, 12)}, ` +
      `kept in this browser, ${manifest.displays.length} displays. ` +
      (unknown
        ? `${unknown} of the ${manifest.sources.length} files it was made from are not of the retail disks WinBox knows. `
        : '') +
      (manifest.displays.includes('vga256')
        ? ''
        : "For 256 colours, drop the Super VGA 256-colour driver's files (OEMSETUP.INF and SVGA256.DRV, unpacked from the Driver Library's svga.exe) with the disks.")
    ).trim();
  }

  return (
    'No Windows. Drop the images of your Windows 3.1 setup disks, a winbox-assets.zip ' +
    'made from them, or a zip of your own Windows 3.1 directory, to give programs its fonts.'
  );
}

/** The changes kept, as the Changes kept panel lists them. */
export interface ChangesView {
  text: string;
  rows: string[];

  /** Whether there is anything to forget. */
  forgettable: boolean;
}

export function changesView(changes: Change[], tooLarge: string[]): ChangesView {
  const note = tooLarge.length ? ` Not kept, being larger than 8 MB: ${tooLarge.join(', ')}.` : '';

  return {
    text:
      (changes.length
        ? 'What programs wrote on C:, kept in this browser and put back each time the page is opened:'
        : 'Nothing written on C: yet. What programs write there is kept in this browser, and put back each time the page is opened.') +
      note,
    rows: changes.map((change) =>
      change.kind === 'removed'
        ? `C:\\${change.path}  (deleted)`
        : change.kind === 'folder'
          ? `C:\\${change.path}\\`
          : `C:\\${change.path}`
    ),
    forgettable: changes.length > 0,
  };
}

/** A kept program as its row shows it. */
export interface KeptRow {
  name: string;

  /** Its name, with the display it was made on where that is not the display now. */
  label: string;

  /** Whether it was made on the base and display C: is now, and so may be opened. */
  here: boolean;

  /** Whether it is the program on C: now. */
  shown: boolean;

  /** What its Open or Close button says to a screen reader. */
  openLabel: string;

  /** The display it was made on, as it is shown. */
  display: string;

  /** Its own Program Manager groups, once read; none while being read. */
  groups: StackGroup[] | null;
}

/**
 * The programs kept, each with the way to put its stack on C: and to
 * forget it: those made on another display offered on that display.
 */
export function keptRows(
  programs: KeptProgram[],
  chosen: KeptProgram | null,
  base: string | null,
  display: string,
  groupsOf: (program: KeptProgram) => StackGroup[] | null
): KeptRow[] {
  return programs.map((program) => {
    const here = program.base === base && program.display === display;
    const shown = program === chosen;
    const shownDisplay = displayName(program.display);

    return {
      name: program.name,
      label: here ? program.name : `${program.name} (${shownDisplay})`,
      here,
      shown,
      openLabel: shown
        ? `Close ${program.name}`
        : here
          ? `Open ${program.name}`
          : `${program.name} was made on the ${shownDisplay}, and is opened there`,
      display: program.display,
      groups: groupsOf(program),
    };
  });
}

/** A program offered to run. */
export interface ProgramRow {
  program: Program;
  path: string;
  runnable: boolean;
  label: string;
}

/** The programs offered: C:'s, then those on the drives of images; or why there are none. */
export function programRows(
  plan: Pick<Plan, 'programs'> | null,
  onDrives: Program[],
  dropped: boolean
): { rows: ProgramRow[]; empty: string | null } {
  const programs = [...(plan?.programs ?? []), ...onDrives];

  return {
    rows: programs.map((program) => ({
      program,
      path: program.path,
      runnable: program.kind === 'windows',
      label:
        program.kind === 'windows'
          ? `Run ${program.path}`
          : `${program.path} is a DOS program, which is not run here`,
    })),
    empty:
      plan && !programs.length
        ? dropped
          ? 'No programs in what was dropped.'
          : 'Drop a zip of programs to run.'
        : null,
  };
}

/** The files on C: but Windows' own, those renamed with the name they had. */
export function fileRows(plan: Pick<Plan, 'files' | 'renamed'> | null) {
  const renamed = new Map((plan?.renamed ?? []).map((one) => [one.to, one.from]));

  return (plan?.files ?? [])
    .filter((file) => !file.startsWith('C:\\WINDOWS\\'))
    .map((file) => (renamed.has(file) ? `${file}  (was ${renamed.get(file)})` : file));
}

/** A drive of images as its row shows it, with what may be done with it. */
export interface DriveRow {
  letter: string;

  /** What is in it, as its label says: `A: Disk 1 of 2, one.img`. */
  text: string;
  kind: 'floppy' | 'CD-ROM' | 'hard disk';

  /** What a screen reader is told of the row. */
  label: string;

  /** Its disks, to choose among where there are several. */
  disks: string[];
  current: number;
  ejected: boolean;

  /** Whether each action is offered. */
  next: boolean;
  insert: boolean;
  eject: boolean;
  save: boolean;

  /** Whether more disks may be added to its set. */
  add: boolean;

  /** An installer on it, offered to install; none where it is not offered. */
  installer: Program | null;
}

export function driveRows(
  drives: DriveSet[],
  programsOf: (letter: string) => Program[],
  base: string | null,
  installing: boolean
): DriveRow[] {
  return drives.map((set) => {
    const kind = set.kind === 'iso' ? 'CD-ROM' : set.kind === 'hdd' ? 'hard disk' : 'floppy';
    const installer = installerOn(programsOf(set.letter));
    const several = set.disks.length > 1;

    return {
      letter: set.letter,
      text: `${set.letter}: ${setText(set)}`,
      kind,
      label: `${set.letter}: ${kind}, ${setText(set)}`,
      disks: set.disks.map((disk, at) => `${at + 1}: ${disk.name}`),
      current: set.current,
      ejected: set.ejected,
      next: several,
      insert: !several && set.ejected,
      eject: set.kind !== 'hdd' && !set.ejected,
      save: set.kind !== 'iso' && !set.ejected,
      add: set.kind !== 'hdd',
      installer: installer && base && !installing ? installer : null,
    };
  });
}

/** A file asked for again, or a cue sheet's file still wanted. */
export interface NeededRow {
  letter: string;
  name: string;
  text: string;
  label: string;

  /** Its extension, for the file input's `accept`. */
  accept: string;
}

/** The files an image asked for still wants: itself, and those its cue sheet names. */
export const stillWanted = (needed: Needed) => [
  ...(needed.have ? [] : [{ name: needed.name, size: needed.size }]),
  ...(needed.tracks ?? []).filter((_, at) => !needed.trackDisks?.[at]),
];

export function neededRows(needed: Needed[], wanting: Wanting[]): NeededRow[] {
  return [
    ...needed
      .filter((one) => !one.disk)
      .flatMap((one) =>
        stillWanted(one).map((file) => ({
          letter: one.letter,
          name: file.name,
          text: `${one.letter}: ${file.name} (${Math.ceil(file.size / 1024)} KB) for ${one.program}`,
        }))
      ),
    ...wanting.flatMap((wait) =>
      missingOf(wait).map((name) => ({
        letter: '',
        name,
        text: `${name} for ${wait.cue.name}`,
      }))
    ),
  ].map((one) => ({
    ...one,
    accept: one.name.slice(one.name.lastIndexOf('.')),
    label: one.letter ? `Choose ${one.name} for ${one.letter}: again` : `Choose ${one.name}`,
  }));
}

/** The installer's file in an archive, as DOS names it: `SETUP.EXE`. */
export const installerName = (archive: Archive, installer: string | null) =>
  (installer ?? '').split('/').pop()!.toUpperCase();

/** A program's name, as its archive names it. */
export const programName = (archive: Archive) => archive.name.replace(/\.zip$/i, '');

/** A name no kept program has: the name, or it numbered. */
export function freeName(programs: KeptProgram[], name: string) {
  const taken = new Set(programs.map((program) => program.name));

  for (let number = 2; taken.has(name); number++) {
    if (!taken.has(`${name} ${number}`)) {
      return `${name} ${number}`;
    }
  }

  return name;
}

/** The offer to install, or the installer running, with what may be done. */
export interface InstallView {
  /** Whether the section is shown at all. */
  shown: boolean;
  note: string;

  /** The programs it may install into, the first a program of its own (`''`); none unless offered. */
  options: { value: string; text: string }[];

  /** The one chosen, kept where it is still offered. */
  into: string;

  /** Whether each button is offered. */
  install: boolean;
  keepAsProgram: boolean;
  keep: boolean;
  discard: boolean;
}

export function installView(
  offer: Archive | null,
  offerInstaller: string | null,
  driveOffer: DriveOffer | null,
  installing: Installing | null,
  here: KeptProgram[],
  all: KeptProgram[],
  chosen: string
): InstallView {
  const offered = offer ?? driveOffer;
  const view: InstallView = {
    shown: Boolean(offered || installing),
    note: '',
    options: [],
    into: '',
    install: Boolean(offered),
    keepAsProgram: Boolean(offer),
    keep: Boolean(installing?.ended),
    discard: Boolean(installing),
  };

  if (offered) {
    const name = offer ? programName(offer) : driveOffer!.name;

    view.note = offer
      ? `${offer.name} holds an installer, ${installerName(offer, offerInstaller)}. Installed, what it writes ` +
        'on C: is kept as a layer, and its setup files let go of; or the archive is kept as it is.'
      : `${driveOffer!.letter}: holds an installer, ${driveOffer!.installer.path}. Installed, ` +
        'what it writes on C: is kept as a layer; its disks are not kept with it.';
    view.options = [
      { value: '', text: `as ${freeName(all, name)}, a program of its own` },
      ...here.map((program) => ({ value: program.name, text: `into ${program.name}` })),
    ];
    view.into = here.some((program) => program.name === chosen) ? chosen : '';
  } else if (installing) {
    view.note = installing.ended
      ? `The installer has ended. Keep what it installed${installing.into ? ` into ${installing.into}` : ''} as a layer, or discard it.`
      : installing.drive
        ? `Installing ${installing.name} from ${installing.from}, run as ${installing.installer}.`
        : `Installing ${installing.name} from ${installing.from}: its setup files are at C:\\${MEDIA} while it runs.`;
  }

  return view;
}

/** The engine running, as the header names it, with the way to the other. */
export function engineView(rust: boolean, unbuilt: boolean) {
  return {
    text: rust
      ? 'Rust engine (WebAssembly). '
      : unbuilt
        ? 'TypeScript engine: the Rust engine is not built (pnpm build:web). '
        : 'TypeScript engine. ',
    href: rust ? '?engine=ts' : '?engine=rust',
    link: rust ? 'Use the TypeScript engine' : 'Use the Rust engine',
  };
}

/** A function called, as the trace lists it. */
export interface TraceRow {
  name: string;
  text: string;
  stub: boolean;
}

/** The functions called, those reaching nothing first, then the most called, then by name. */
export function traceRows(counts: Map<string, { count: number; stub: boolean }>): TraceRow[] {
  return [...counts.entries()]
    .sort(
      ([a, one], [b, other]) =>
        Number(other.stub) - Number(one.stub) || other.count - one.count || a.localeCompare(b)
    )
    .map(([name, entry]) => ({
      name,
      text: `${name} ×${entry.count}${entry.stub ? ' — not implemented' : ''}`,
      stub: entry.stub,
    }));
}

/** Everything the page shows but the trace and the status line, which change far more often. */
export interface PageView {
  engine: ReturnType<typeof engineView>;

  /** Whether the engine has a sound card to give (the Rust engine's). */
  soundOffered: boolean;
  windows: string;
  forgettable: boolean;
  changes: ChangesView;
  displays: { value: string; text: string }[];
  display: string;
  coprocessor: boolean;
  sound: boolean;
  keepImages: boolean;
  drivesNote: string;
  drives: DriveRow[];
  needed: NeededRow[];
  kept: KeptRow[];
  keptNote: string;
  install: InstallView;
  programs: ProgramRow[];
  programsEmpty: string | null;
  files: string[];
}

/** The note over the drives, with drives and without. */
export function drivesNote(any: boolean) {
  return any
    ? 'Disk and CD images, read where they are, never written: what programs write to a disk is kept for the visit, and saved as a new file.'
    : 'No drives but C:. Drop disk or CD images (.img, .iso, or a .cue with its .bin files) here beside Windows, or add them: several floppies dropped together are one set, in the order of their names.';
}

export const KEPT_NOTE =
  'Each on a C: of its own, over Windows, with what it writes. Programs dropped are kept here.';
