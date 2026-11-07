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
import { type KeptProgram, type Medium, modeOfProgram } from '../store.js';
import { type WindowsMode } from '../../emulator/machine.js';
import { type Icon } from '../../layers/groups.js';
import { type KeptGroup, type KeptGroups } from './groups.js';
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

  /** Whether it was made on the Windows dropped, on a display it offers, and so may be opened. */
  here: boolean;

  /** Whether its machine is the one shown, whose tab has its Close. */
  shown: boolean;

  /** Whether a machine runs it, shown or in a tab behind. */
  running: boolean;

  /** What its button says -- Open, or Show where its machine is in a tab behind -- and to a screen reader. */
  openText: string;
  openLabel: string;

  /** The display it was made on, as it is shown. */
  display: string;

  /** The mode Windows ran in as it was installed, which it runs in. */
  mode: WindowsMode;

  /** Its own Program Manager groups, those its install made, once read; none while being read. */
  groups: KeptGroup[] | null;
}

/**
 * The modes a machine is made in, as the Machine panel offers them: Windows
 * started as `win /s` or as `win /3` (`kb/guides/enhanced-mode.md`).
 */
export const MODES: { value: WindowsMode; text: string }[] = [
  { value: 'standard', text: 'Standard mode' },
  { value: 'enhanced', text: '386 enhanced mode' },
];

/** A mode as it is shown. */
export const modeName = (mode: WindowsMode) =>
  MODES.find((one) => one.value === mode)?.text ?? mode;

/**
 * The programs kept, each with the way to its machine and to forget it:
 * Open makes it a machine of its own, on the display it was made on, as
 * the launcher does; Show, where one runs it in a tab behind, shows that
 * tab; the one shown has its tab's Close. Each is named with the display
 * it was made on where that is not the display of the machine shown, and
 * with its mode where that is not the machine shown's.
 */
export function keptRows(
  programs: KeptProgram[],
  running: (name: string) => 'shown' | 'behind' | null,
  baseOf: (display: string) => string | null,
  displays: string[],
  display: string,
  groupsOf: (program: KeptProgram) => KeptGroups | null,
  mode: WindowsMode = 'standard'
): KeptRow[] {
  return programs.map((program) => {
    const based = program.base === baseOf(program.display);
    const offered = displays.includes(program.display);
    const here = based && offered;
    const machine = running(program.name);
    const shownDisplay = displayName(program.display);
    const facts = [
      ...(program.display === display ? [] : [shownDisplay]),
      ...(modeOfProgram(program) === mode ? [] : [modeName(modeOfProgram(program))]),
    ];

    return {
      name: program.name,
      label: facts.length ? `${program.name} (${facts.join(', ')})` : program.name,
      here,
      shown: machine === 'shown',
      running: machine !== null,
      openText: machine === 'behind' ? 'Show' : 'Open',
      openLabel:
        machine === 'behind'
          ? `Show ${program.name}`
          : here
            ? `Open ${program.name}`
            : !based
              ? `${program.name} was made on a Windows that is not here`
              : `${program.name} was made on the ${shownDisplay}, which this Windows does not offer`,
      display: program.display,
      mode: modeOfProgram(program),
      groups: groupsOf(program)?.groups.filter((group) => !group.winbox) ?? null,
    };
  });
}

/** What a machine's tab is named by. */
export interface MachineFacts {
  id: number;

  /** The kept program it runs; none for the base alone. */
  program: string | null;

  /** The program an installer on it installs; none where none runs. */
  installing: string | null;
  display: string;

  /** Whether it has Windows: an installation, or the asset bundle's base for its display. */
  windows: boolean;
}

/**
 * A machine's name, as its tab shows it and its Close says: its install's
 * -- the kept program it runs -- or, with none, `Windows` for the base
 * alone and what is dropped loose on it, `No Windows` without one; an
 * installer's `Installing` and its program's name.
 */
export function machineName(facts: MachineFacts) {
  return facts.installing
    ? `Installing ${facts.installing}`
    : (facts.program ?? (facts.windows ? 'Windows' : 'No Windows'));
}

/** A machine's tab. */
export interface TabView {
  id: number;

  /** Its name, with its display where another tab has the same name. */
  name: string;
  selected: boolean;
}

/** The machines' tabs, in their order, the one shown selected. */
export function tabsView(machines: MachineFacts[], shown: number): TabView[] {
  const names = machines.map(machineName);

  return machines.map((facts, at) => ({
    id: facts.id,
    name:
      names.filter((name) => name === names[at]).length > 1
        ? `${names[at]} (${displayName(facts.display)})`
        : names[at],
    selected: facts.id === shown,
  }));
}

/**
 * The machine shown once one is closed: the same where another was
 * closed; else the tab after it, or before it where it was the last; none
 * where it was the only one.
 */
export function shownAfterClosing(ids: number[], closed: number, shown: number): number | null {
  if (closed !== shown && ids.includes(shown)) {
    return shown;
  }

  const at = ids.indexOf(closed);
  const rest = ids.filter((id) => id !== closed);

  return rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : null;
}

/** An item as the launcher's menu shows it (`kb/guides/launcher.md`). */
export interface LauncherItem {
  name: string;
  icon: Icon | null;

  /** The display its icon is drawn for: its program's. */
  display: string;

  /** Its command and working directory, as the item has them. */
  command: string;
  directory: string;

  /** Why it cannot be run, in words; null where it can. */
  reason: string | null;

  /** Whether its working directory is there: where not, Program Manager asks before going on. */
  directoryThere: boolean;

  /** Where it is: its program, and its group's and its own places in the launcher's list. */
  install: string;
  group: number;
  item: number;
}

/** A group as the launcher's menu shows it: an entry of the menu, opening to its items. */
export interface LauncherGroup {
  /** Its name, with its install's where another install has a group of the same name. */
  label: string;
  install: string;

  /** Why it has no items to show: being read, or a group file Program Manager would not load. */
  note: string | null;
  items: LauncherItem[];
}

/** The launcher's menu: every kept program's groups, or what to do where none is kept. */
export interface LauncherView {
  groups: LauncherGroup[];
  empty: string | null;
}

/** What the launcher's menu says with no program kept. */
export const LAUNCHER_EMPTY =
  'No programs are kept yet. Drop a program, or install one, and its groups are listed here.';

/**
 * The launcher's menu (`kb/guides/launcher.md`): each kept program's
 * groups in the order they were kept -- its install's, or WinBox's own of
 * a program kept loose -- each labelled with its install's name where two
 * installs have a group of the same name, never merged. An item that
 * cannot run says why: what its run needs and does not find (`itemRun`),
 * or that its program was made on a Windows, or a display, that is not
 * here.
 */
export function launcherView(
  programs: KeptProgram[],
  groupsOf: (program: KeptProgram) => KeptGroups | null,
  displays: string[]
): LauncherView {
  if (!programs.length) {
    return { groups: [], empty: LAUNCHER_EMPTY };
  }

  const read = programs.map((program) => ({ program, kept: groupsOf(program) }));
  const names = new Map<string, Set<string>>();

  for (const { program, kept } of read) {
    for (const group of kept?.groups ?? []) {
      names.set(group.name, (names.get(group.name) ?? new Set()).add(program.name));
    }
  }

  const groups = read.flatMap(({ program, kept }): LauncherGroup[] => {
    if (!kept) {
      return [{ label: program.name, install: program.name, note: 'Being read…', items: [] }];
    }

    const unrunnable = !kept.based
      ? `${program.name} was made on a Windows that is not here`
      : !displays.includes(program.display)
        ? `${program.name} was made on the ${displayName(program.display)}, which this Windows does not offer`
        : null;

    return kept.groups.map((group, at) => ({
      label:
        (names.get(group.name)?.size ?? 0) > 1 ? `${group.name} (${program.name})` : group.name,
      install: program.name,
      note: group.refusal
        ? `Program Manager would not load it: ${group.refusal}`
        : group.items.length
          ? null
          : 'No items',
      items: group.items.map((item, index) => ({
        name: item.name,
        icon: item.icon,
        display: program.display,
        command: item.command,
        directory: item.directory,
        reason: unrunnable ?? item.run.reason,
        directoryThere: item.run.directoryThere,
        install: program.name,
        group: at,
        item: index,
      })),
    }));
  });

  return { groups, empty: null };
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

/** A disk of a drive's set, as its drive's card lists it. */
export interface DiskView {
  /** Its file's name, as it was dropped or chosen. */
  name: string;

  /** Whether it is the disk in the drive. */
  inserted: boolean;

  /** Whether programs have written to it: what they wrote is in its overlay, the file never written. */
  written: boolean;

  /** How it is had again on a later visit, where a kept program is run with it; null where none is. */
  kept: string | null;

  /** What the list shows of it, and a screen reader is told: `Disk 1, one.img, in the drive, written to`. */
  text: string;
}

/** A drive of images as its card shows it, with what may be done with it. */
export interface DriveRow {
  letter: string;

  /** What is in it, with its letter: `A: Disk 1 of 2, one.img`. */
  text: string;
  kind: 'floppy' | 'CD-ROM' | 'hard disk';

  /** What it is, as its card's heading says after its letter: `floppy drive`. */
  kindText: string;

  /** What a screen reader is told of the card: `A: floppy drive, Disk 1 of 2, one.img`. */
  label: string;

  /** What is in it, without its letter: `Disk 1 of 2, one.img`, or `Empty (2 disks)`. */
  state: string;

  /** A disc's volume label, where the page read one; null for any other, or a disc without. */
  volume: string | null;

  /** Whether programs may not write to it: a disc. */
  readOnly: boolean;

  /** Its disks, to choose among where there are several. */
  disks: string[];

  /** Its disks as the card lists them. */
  set: DiskView[];
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

  /** How its images are had on a later visit: with the kept program on C:, or not at all. */
  kept: string;

  /** What its Remove asks first: what is lost. */
  removing: string;
}

/** What the page knows of each drive beside its set: what the engine and the browser say. */
export interface DriveFacts {
  /** Whether programs have written to a disk of a drive's set (`Engine.diskChanged`, `Disk.written`). */
  written(letter: string, disk: number): boolean;

  /** A drive's volume label, as the page read its disk. */
  volume(letter: string): string | null;

  /** How a disk is had again on a later visit; null where no kept program is run with it. */
  kept(disk: Disk): string | null;

  /** The kept program on C:, which is run with the drives; null for none. */
  program: string | null;
}

/** What the page knows of no drive: nothing written, no label, nothing kept. */
const NO_FACTS: DriveFacts = {
  written: () => false,
  volume: () => null,
  kept: () => null,
  program: null,
};

/** How a kept program's image is had again: from a handle on its file, from a copy, or chosen again. */
export function keptText(handle: boolean, copy: boolean) {
  return handle
    ? 'opened again from its file next visit, the browser asking leave'
    : copy
      ? 'a copy kept in this browser'
      : 'chosen again next visit';
}

export function driveRows(
  drives: DriveSet[],
  programsOf: (letter: string) => Program[],
  base: string | null,
  installing: boolean,
  facts: DriveFacts = NO_FACTS
): DriveRow[] {
  return drives.map((set) => {
    const kind = set.kind === 'iso' ? 'CD-ROM' : set.kind === 'hdd' ? 'hard disk' : 'floppy';
    const kindText =
      set.kind === 'iso' ? 'CD-ROM drive' : set.kind === 'hdd' ? 'hard disk' : 'floppy drive';
    const installer = installerOn(programsOf(set.letter));
    const several = set.disks.length > 1;
    const state = setText(set);
    const noun = set.kind === 'iso' ? 'Disc' : 'Disk';
    const view = set.disks.map((disk, at): DiskView => {
      const inserted = !set.ejected && at === set.current;
      const written = set.kind !== 'iso' && (disk.written || facts.written(set.letter, at));

      return {
        name: disk.name,
        inserted,
        written,
        kept: facts.kept(disk),
        text: [
          several ? `${noun} ${at + 1}, ${disk.name}` : disk.name,
          ...(inserted ? ['in the drive'] : []),
          ...(written ? ['written to'] : []),
        ].join(', '),
      };
    });
    const what = set.kind === 'iso' ? 'its disc' : several ? 'its disks' : 'its disk';
    const ways = [...new Set(view.map((disk) => disk.kept).filter(Boolean))];

    return {
      letter: set.letter,
      text: `${set.letter}: ${state}`,
      kind,
      kindText,
      label: `${set.letter}: ${kindText}, ${state}`,
      state,
      volume: set.kind === 'iso' ? facts.volume(set.letter) : null,
      readOnly: set.kind === 'iso',
      disks: set.disks.map((disk, at) => `${at + 1}: ${disk.name}`),
      set: view,
      current: set.current,
      ejected: set.ejected,
      next: several,
      insert: !several && set.ejected,
      eject: set.kind !== 'hdd' && !set.ejected,
      save: set.kind !== 'iso' && !set.ejected,
      add: set.kind !== 'hdd',
      installer: installer && base && !installing ? installer : null,
      kept:
        facts.program && ways.length
          ? `Kept with ${facts.program}: ${ways.join('; ')}.`
          : 'Not kept: for this visit only.',
      removing:
        (set.kind === 'iso'
          ? `${set.letter}: and ${what} are let go of. To have it again, choose or drop its images again.`
          : `${set.letter}: and ${what} are let go of, and what programs wrote to ${what} this visit is discarded. Save the image first to keep it.`) +
        (facts.program ? ` ${facts.program} is no longer run with it.` : ''),
    };
  });
}

/** C:, the hard disk every program is on, as its card shows it. */
export interface CDriveView {
  /** What Windows on it is: `Windows 3.1 from your setup disks (VGA, 640x480, 16 colours)`. */
  windows: string;

  /** What is over Windows: the kept program on it and its layers, or the archives dropped loose. */
  programs: string;

  /** What programs wrote on it, kept in this browser. */
  changes: string;

  /** What a screen reader is told of it. */
  label: string;
}

export function cDriveView(
  windows: Pick<Archive, 'name'> | null,
  assets: object | null,
  display: string,
  chosen: Pick<KeptProgram, 'name' | 'layers'> | null,
  loose: number,
  changes: number
): CDriveView {
  const count = (number: number, one: string) => `${number} ${one}${number === 1 ? '' : 's'}`;
  const windowsLine = windows
    ? `Windows 3.1 from ${windows.name}`
    : assets
      ? `Windows 3.1 from your setup disks (${displayName(display)})`
      : 'No Windows yet';
  const programs = chosen
    ? `${chosen.name}, kept: ${count(chosen.layers.length, 'layer')} over Windows`
    : loose
      ? `${count(loose, 'archive')} dropped over Windows`
      : 'No program kept on it';
  const changesLine = changes
    ? `${count(changes, 'change')} programs wrote, kept in this browser`
    : 'Nothing programs wrote kept yet';

  return {
    windows: windowsLine,
    programs,
    changes: changesLine,
    label: `C: hard disk, ${windowsLine}`,
  };
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

  /** The modes offered, and the machine shown's. */
  modes: { value: WindowsMode; text: string }[];
  mode: WindowsMode;
  coprocessor: boolean;
  sound: boolean;
  keepImages: boolean;
  drivesNote: string;
  c: CDriveView;
  drives: DriveRow[];
  needed: NeededRow[];
  kept: KeptRow[];
  keptNote: string;
  launcher: LauncherView;
  install: InstallView;
  programs: ProgramRow[];
  programsEmpty: string | null;

  /** The machines' tabs, the one the rest speaks for selected. */
  tabs: TabView[];
}

/** The note over the drives, with drives and without. */
export function drivesNote(any: boolean) {
  return any
    ? 'Disk and CD images, read where they are, never written: what programs write to a disk is kept for the visit, and saved as a new file.'
    : 'No drives but C:. Drop disk or CD images (.img, .iso, or a .cue with its .bin files) here beside Windows, or add them: several floppies dropped together are one set, in the order of their names.';
}

export const KEPT_NOTE =
  'Each on a C: of its own, over Windows, with what it writes. Programs dropped are kept here.';
