/**
 * The page for running real Windows 3.1 programs: drop zip archives on it, and
 * it puts them on a C: drive and offers every Windows program on it to run.
 *
 * A zip of a Windows installation gives the programs Windows' own fonts and
 * files; it is found by what it holds and remembered in this browser, so it is
 * dropped once. In its place, the user's Windows 3.1 setup disks -- their
 * images -- make WinBox's asset bundle here, in the browser
 * (`kb/topics/asset-bundle.md`), or a bundle already made is dropped; the
 * bundle is remembered as an installation is, and C: is the base it composes
 * for the display chosen, with no installation at all. A zip of programs
 * dropped over either is kept as a program of its own, a layer over that
 * Windows (`kb/formats/layer.md`), and listed on every visit, each run on
 * its own stack. What programs write on C: is remembered too, as the changes
 * against what was dropped (`changes.ts`), and put back on the drive each time
 * it is made, on either engine. Nothing is uploaded anywhere. Each program's
 * API calls are traced as it runs -- the functions it needed, and which of
 * those reached nothing -- which is what testing a real program against this
 * implementation and the oracle's recordings starts from.
 *
 * The page is the same whichever engine runs the programs (`engines/`): the
 * Rust engine built for WebAssembly, by default, once `pnpm build:web` has
 * built it, or the TypeScript engine, at `run.html?engine=ts` -- and where
 * the Rust engine has not been built.
 *
 * Served by `pnpm dev` at `/run.html`. Not part of the distributed bundle.
 */

import { Assets } from '../assets/bundle.js';
import { composedDisplays } from '../assets/compose.js';
import { type AssetInput } from '../assets/make.js';
import { DISPLAY_MODES } from '../win16/display-modes.js';
import { DeviceBitmap } from '../raster/device-bitmap.js';
import { Presenter } from '../raster/presenter.js';
import { readZip } from '../zip.js';
import { type Change, sameChanges } from './changes.js';
import { installedLayer, type MediaReference } from '../layers/install.js';
import {
  baseName,
  type Layer,
  type LayerEntry,
  type LayerManifest,
  touching,
} from '../layers/layer.js';
import {
  type Archive,
  layerPrograms,
  type Plan,
  planDrive,
  type Program,
  programLayer,
  type Stack,
} from './drive.js';
import { type Engine, type Page } from './engines/engine.js';
import { TypeScriptEngine } from './engines/ts.js';
import {
  assignLetters,
  type Disk,
  type DriveSet,
  imageKey,
  type ImageKind,
  imageKind,
  missingOf,
  pairCues,
  type Wanting,
  installerOn,
  isKnownMedia,
  type KnownFiles,
  orderSet,
  programsOn,
  setText,
  volumeOf,
} from './drives.js';
import { classify, installerOf, makeFromMedia } from './media.js';
import {
  assetsIdentity,
  forgetAllChanges,
  forgetAssets,
  forgetChanges,
  forgetWindows,
  forgetAllPrograms,
  forgetProgram,
  identify,
  keepProgram,
  type Kept,
  type KeptProgram,
  keptCounts,
  imageCounts,
  type Medium,
  programChangesKey,
  programIdentity,
  recallAssets,
  recallChanges,
  recallChangesAt,
  recallLayers,
  recallImage,
  recallPrograms,
  recallWindows,
  rememberAssets,
  rememberChanges,
  rememberImage,
  rememberProgram,
  rememberWindows,
} from './store.js';
import './run.css';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const elements = {
  engine: $<HTMLElement>('#engine'),
  drop: $<HTMLElement>('#drop'),
  picker: $<HTMLInputElement>('#picker'),
  windows: $<HTMLElement>('#windows'),
  forget: $<HTMLButtonElement>('#forget'),
  changes: $<HTMLElement>('#changes'),
  changed: $<HTMLElement>('#changed'),
  forgetChanges: $<HTMLButtonElement>('#forget-changes'),
  display: $<HTMLSelectElement>('#display'),
  coprocessor: $<HTMLInputElement>('#coprocessor'),
  soundOption: $<HTMLElement>('#sound-option'),
  sound: $<HTMLInputElement>('#sound'),
  keptSection: $<HTMLElement>('#kept-section'),
  keptNote: $<HTMLElement>('#kept-note'),
  keptPrograms: $<HTMLElement>('#kept-programs'),
  installSection: $<HTMLElement>('#install-section'),
  installNote: $<HTMLElement>('#install-note'),
  installTarget: $<HTMLElement>('#install-target'),
  installInto: $<HTMLSelectElement>('#install-into'),
  install: $<HTMLButtonElement>('#install'),
  keepAsProgram: $<HTMLButtonElement>('#keep-as-program'),
  installKeep: $<HTMLButtonElement>('#install-keep'),
  installDiscard: $<HTMLButtonElement>('#install-discard'),
  drivesNote: $<HTMLElement>('#drives-note'),
  drives: $<HTMLElement>('#drives'),
  needed: $<HTMLElement>('#needed'),
  chooseImages: $<HTMLButtonElement>('#choose-images'),
  imagePicker: $<HTMLInputElement>('#image-picker'),
  keepImages: $<HTMLInputElement>('#keep-images'),
  programs: $<HTMLElement>('#programs'),
  files: $<HTMLElement>('#files'),
  desktop: $<HTMLElement>('#desktop'),
  counts: $<HTMLElement>('#counts'),
  recent: $<HTMLElement>('#recent'),
  status: $<HTMLElement>('#status'),
};

/**
 * What has been dropped: program archives, and at most one Windows -- an
 * installation, with what tells it apart (`identify`), or an asset bundle --
 * and the media dropped since the page was opened, which media dropped
 * after are added to: the Super VGA driver's files after the disks.
 */
const state: {
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
};

/**
 * An installer on a drive of images offered to install
 * (`kb/formats/layer.md`, "Media on another drive"): run from its floppy
 * or disc, nothing of its media put on C:.
 */
interface DriveOffer {
  letter: string;
  installer: Program;

  /** The program's name: its first image's, without its extension. */
  name: string;
}

/** An image a kept program is run with, not yet had on this visit: asked for again by its name. */
interface Needed extends Medium {
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
const MEDIA = 'WBSETUP';

/**
 * A program's installer running over a stack (`kb/formats/layer.md`): its
 * archive put on C: as its media, at `C:\WBSETUP`, over the stack of the
 * kept program it installs into, or the base alone, with nothing written
 * on it yet; until it is kept as a layer, or let go of.
 */
interface Installing {
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
const stacks = new Map<string, Layer[]>();

/** The base C: is now: its name as a stack names it, or null with no Windows. */
function baseNow() {
  return state.windows && state.installation
    ? `install:${state.installation}`
    : state.assets
      ? baseName(state.assets.id, elements.display.value)
      : null;
}

/** The program chosen, where it was made on the base and display C: is now. */
function programNow() {
  const program = state.programs.find((one) => one.name === state.program);

  return program && program.base === baseNow() && program.display === elements.display.value
    ? program
    : null;
}

/**
 * What the changes programs write are told against: the program chosen's
 * stack (`programIdentity`); else the installation, or the asset bundle
 * and the display, whose base differs with the display (`assetsIdentity`);
 * null with neither.
 */
function identityNow() {
  const program = programNow();

  if (program) {
    return programIdentity(program.name, program.base, program.display, program.layers);
  }

  return !state.windows && state.assets
    ? assetsIdentity(state.assets.id, elements.display.value)
    : state.installation;
}

/** What the machine as last made was told against, and so what its changes are kept against. */
let built: string | null = null;

/** Where everything dropped is on C:, as the engine's machine was last made from. */
let plan: Plan | null = null;

/* ---- the trace ---- */

const counts = new Map<string, { count: number; stub: boolean }>();
const recent: string[] = [];
let traceFrame = 0;

function renderTrace() {
  traceFrame = 0;

  const rows = [...counts.entries()].sort(
    ([a, one], [b, other]) =>
      Number(other.stub) - Number(one.stub) || other.count - one.count || a.localeCompare(b)
  );

  elements.counts.replaceChildren(
    ...rows.map(([name, entry]) => {
      const row = document.createElement('li');
      row.className = entry.stub ? 'stub' : '';
      row.textContent = `${name} ×${entry.count}${entry.stub ? ' — not implemented' : ''}`;
      return row;
    })
  );

  elements.recent.textContent = recent.join('\n');
}

/** A call a program made, counted and kept among the most recent. */
function trace(name: string, stub: boolean, line: string) {
  const entry = counts.get(name) ?? { count: 0, stub };

  entry.count++;
  counts.set(name, entry);

  recent.push(line);

  if (recent.length > 200) {
    recent.shift();
  }

  traceFrame ||= requestAnimationFrame(renderTrace);

  if (name === 'USER.ExitWindows') {
    status('The program asked Windows to end the session, and has finished.');

    /* An installer that ends Windows has ended. */
    if (state.installing) {
      installerEnded();
    }
  }
}

function status(message: string, kind: 'info' | 'error' = 'info') {
  elements.status.textContent = message;
  elements.status.className = kind;
}

/* ---- the engine ---- */

const page: Page = {
  desktop: elements.desktop,
  status,
  call: trace,
  /* What a program wrote kept as it ends; an installer's, once its task
   * has ended, kept only as the user says (`keepInstalled`). */
  ended: () => (state.installing ? installerEnded() : keep()),
};

/** Where `pnpm build:web` writes the Rust engine's module, as `pnpm dev` serves it. */
const RUST_MODULE = '/target/winbox-web/winbox_web_bg.wasm';

/** The engine the page's address asks for, if it asks. */
const asked = new URLSearchParams(location.search).get('engine');

/** Whether the Rust engine's module has been built, for a page that asks for neither. */
async function rustBuilt(): Promise<boolean> {
  try {
    return (await fetch(RUST_MODULE, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/**
 * Which engine runs the programs: the Rust engine, unless the page's address
 * asks for the TypeScript engine, or the Rust engine has not been built.
 */
const rust = asked === 'ts' ? false : asked === 'rust' ? true : await rustBuilt();

/** Whether the Rust engine was wanted but not there, which the header says. */
const unbuilt = asked === null && !rust;
const engineName = rust ? 'Rust' : 'TypeScript';

/**
 * The engine, made once. The Rust engine's module, and its glue, are only
 * loaded where it is asked for.
 */
const engine: Promise<Engine> = rust
  ? import('./engines/rust.js').then(({ RustEngine }) => new RustEngine(page))
  : Promise.resolve(new TypeScriptEngine(page));

/** The engine, once it is made, for the browser's console. */
let made: Engine | null = null;

engine.then((one) => {
  made = one;
  one.sound = elements.sound.checked;
});

/* ---- what programs write, kept ---- */

/**
 * The largest file kept. IndexedDB has room for far more, but a program's
 * own data files are rarely this large, and one that is would be written
 * again with every save.
 */
const LIMIT = 8 * 1024 * 1024;

/** How often what programs write is kept while the page is shown, in milliseconds. */
const EVERY = 5000;

/** What programs wrote on C:, as it was last kept, against the installation dropped. */
let kept: Kept = { installation: null, changes: [] };

/** The files too large to keep, as the last were told. */
let tooLarge: string[] = [];

/**
 * Counted up whenever the machine is made afresh, or what was kept is
 * forgotten: changes told by a machine since gone are not kept.
 */
let generation = 0;

/** Whether the machine is being made afresh, when it has no changes to tell. */
let rebuilding = false;

/** The keeping under way, which another waits for rather than racing it. */
let keeping: Promise<void> | null = null;

/**
 * What programs have written on C: kept in this browser: the engine's
 * changes against the drive as planned, as they stand, written where they
 * are not what was kept last. Kept as a program ends, while the page is
 * shown every few seconds, as it is hidden or left, and before the machine
 * is made afresh. Telling them takes the engine a walk of its drive, and
 * comparing them a look at the bytes of what changed, so no frame waits
 * long on it.
 */
function keep() {
  keeping ??= keepNow().finally(() => (keeping = null));
  return keeping;
}

async function keepNow() {
  const current = made;
  const at = generation;

  /* An installer's top is kept as a layer, and only on "Keep". */
  if (!current || rebuilding || state.installing) {
    return;
  }

  let told: Change[] | null;

  try {
    told = await current.changes();
  } catch (error) {
    console.error(error);
    return;
  }

  if (!told || at !== generation || rebuilding) {
    return;
  }

  const large = told.filter((change) => change.kind === 'file' && change.data.length > LIMIT);
  const changes = told.filter((change) => !large.includes(change));
  const skipped = large.map((change) => `C:\\${change.path}`);

  if (skipped.join() !== tooLarge.join()) {
    tooLarge = skipped;

    if (skipped.length) {
      status(`Not kept, being larger than 8 MB: ${skipped.join(', ')}.`);
    }

    renderChanges();
  }

  if (kept.installation === built && sameChanges(changes, kept.changes)) {
    return;
  }

  const next = { installation: built, changes };

  try {
    await rememberChanges(next);
  } catch (error: any) {
    status(`What programs wrote could not be kept: ${error?.message ?? error}`, 'error');
    return;
  }

  kept = next;
  renderChanges();
}

/** What the machine has written kept as it stands: told afresh, once any keeping under way is done. */
async function keepAll() {
  await keeping;
  await keep();
}

/**
 * Keeping stopped until the machine is made afresh (`rebuild`), once what
 * it wrote is kept, where it is to be: what is dropped, or forgotten, is
 * then changed without a machine still running telling changes against it.
 */
async function hold({ keeping: first = true } = {}) {
  await (first ? keepAll() : keeping);
  rebuilding = true;
  generation++;
}

/** The changes kept, listed, and the way to forget them. */
function renderChanges() {
  const { changes } = kept;
  const note = tooLarge.length ? ` Not kept, being larger than 8 MB: ${tooLarge.join(', ')}.` : '';

  elements.changes.textContent =
    (changes.length
      ? 'What programs wrote on C:, kept in this browser and put back each time the page is opened:'
      : 'Nothing written on C: yet. What programs write there is kept in this browser, and put back each time the page is opened.') +
    note;

  elements.changed.replaceChildren(
    ...changes.map((change) => {
      const row = document.createElement('li');

      row.textContent =
        change.kind === 'removed'
          ? `C:\\${change.path}  (deleted)`
          : change.kind === 'folder'
            ? `C:\\${change.path}\\`
            : `C:\\${change.path}`;
      return row;
    })
  );
  elements.forgetChanges.hidden = !changes.length;
}

/* ---- the drive and the machine ---- */

/**
 * The machine made afresh from what has been dropped, and what programs
 * wrote put back on it; false, with the status line saying why, where the
 * engine could not make it. What the machine it replaces has written is
 * kept first, unless it is being forgotten.
 */
async function rebuild({ keeping = true } = {}) {
  if (keeping) {
    await keepAll();
  }

  generation++;
  rebuilding = true;
  counts.clear();
  recent.length = 0;
  renderTrace();

  /* What programs wrote against what the machine is now made from: kept
   * from before, where it was against another -- another display's base.
   * An installer runs on an empty top, with nothing kept. */
  const installing = state.installing;
  const identity = installing ? null : identityNow();

  if (!installing && kept.installation !== identity) {
    kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };
    tooLarge = [];
  }

  built = identity;

  const display = elements.display.value;
  const assets = state.windows ? null : state.assets;
  /* An installer runs over the stack of the program it installs into. */
  const program = installing
    ? (state.programs.find((one) => one.name === installing.into) ?? null)
    : programNow();
  let composed: ReturnType<Assets['compose']> | null;

  try {
    composed = assets?.compose(display) ?? null;
  } catch (error: any) {
    rebuilding = false;
    status(`The asset bundle has no base for that display: ${error?.message ?? error}`, 'error');
    return false;
  }

  /* The program chosen's stack: its layers over the base, read back. */
  let stack: Stack | undefined;

  if (program) {
    try {
      let layers = stacks.get(program.name);

      if (!layers) {
        layers = await recallLayers(program);
        stacks.set(program.name, layers);
      }

      stack = {
        base: program.base,
        layers: layers.map((layer) => ({ layer, order: program.orders[layer.manifest.id] })),
      };
    } catch (error: any) {
      rebuilding = false;
      status(`${program.name} could not be read back: ${error?.message ?? error}`, 'error');
      render();
      return false;
    }
  }

  try {
    plan = planDrive(
      installing ? (installing.media ? [installing.media] : []) : program ? [] : state.archives,
      state.windows,
      composed,
      stack
    );
  } catch (error: any) {
    rebuilding = false;
    status(
      `${program?.name ?? 'C:'} could not be put together: ${error?.message ?? error}`,
      'error'
    );
    render();
    return false;
  }

  const setup = {
    plan,
    windows: state.windows,
    assets,
    display,
    coprocessor: elements.coprocessor.checked,
    changes: installing ? [] : kept.changes,
    drives: state.drives,
  };

  try {
    const current = await engine;

    /* What programs wrote to the disks of the machine made last kept,
     * for this one to be given. */
    current.carry();
    await current.rebuild(setup);
  } catch (error: any) {
    console.error(error);
    status(`The ${engineName} engine could not start: ${error?.message ?? error}`, 'error');
    render();
    return false;
  } finally {
    rebuilding = false;
  }

  render();
  return true;
}

/** A program run; an installer as Windows runs one, Program Manager the shell starting it. */
async function run(program: Program, options: { install?: boolean } = {}) {
  await (await engine).run(program, options);
}

/* ---- the page ---- */

/** What the page has of Windows, said. */
function windowsText() {
  if (state.windows) {
    return `Windows installation: ${state.windows.name}${plan?.windows ? '' : ' (no SYSTEM fonts found in it)'}`;
  }

  if (state.assets) {
    const { manifest } = state.assets;
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

/**
 * The displays offered: those the asset bundle has a driver and a base for,
 * where C: is its base; every one, else. The one chosen kept where it is
 * offered, VGA else, or the first.
 */
function renderDisplays() {
  const names = Object.keys(DISPLAY_MODES).filter(
    (name) =>
      state.windows ||
      !state.assets ||
      (state.assets.displays.includes(name) && composedDisplays().includes(name))
  );
  const chosen = elements.display.value;

  elements.display.replaceChildren(
    ...names.map((name) => {
      const option = document.createElement('option');

      option.value = name;
      option.textContent = (DISPLAY_MODES as any)[name].description;
      return option;
    })
  );
  elements.display.value = names.includes(chosen)
    ? chosen
    : names.includes('vga')
      ? 'vga'
      : (names[0] ?? '');
}

/**
 * The programs kept, each with the way to put its stack on C: and to
 * forget it: those made on another display offered on that display.
 */
function renderKept() {
  const chosen = programNow();
  const base = baseNow();

  elements.keptSection.hidden = !state.programs.length;
  elements.keptNote.textContent =
    'Each on a C: of its own, over Windows, with what it writes. Programs dropped are kept here.';
  elements.keptPrograms.replaceChildren(
    ...state.programs.map((program) => {
      const row = document.createElement('li');
      const label = document.createElement('code');
      const actions = document.createElement('span');
      const open = document.createElement('button');
      const forget = document.createElement('button');
      const here = program.base === base && program.display === elements.display.value;
      const shown = program === chosen;
      const display = (DISPLAY_MODES as any)[program.display]?.description ?? program.display;

      label.textContent = here ? program.name : `${program.name} (${display})`;
      actions.className = 'actions';

      open.type = 'button';
      open.textContent = shown ? 'Close' : 'Open';
      open.disabled = !here;
      open.setAttribute(
        'aria-label',
        shown
          ? `Close ${program.name}`
          : here
            ? `Open ${program.name}`
            : `${program.name} was made on the ${display}, and is opened there`
      );
      open.addEventListener('click', () => choose(shown ? null : program.name));

      forget.type = 'button';
      forget.textContent = 'Forget';
      forget.setAttribute('aria-label', `Forget ${program.name}`);
      forget.addEventListener('click', () => forgetKept(program.name));

      actions.append(open, forget);
      row.append(label, actions);
      return row;
    })
  );
}

function render() {
  renderInstall();
  elements.windows.textContent = windowsText();
  elements.forget.hidden = !state.windows && !state.assets;
  renderChanges();
  renderKept();

  renderDrives();

  /* C:'s programs, then those on the drives of images. */
  const programs = [
    ...(plan?.programs ?? []),
    ...state.drives.flatMap((set) => drivePrograms.get(set.letter) ?? []),
  ];

  elements.programs.replaceChildren(
    ...programs.map((program) => {
      const row = document.createElement('li');
      const label = document.createElement('code');
      const button = document.createElement('button');

      label.textContent = program.path;
      button.type = 'button';
      button.textContent = program.kind === 'windows' ? 'Run' : 'DOS';
      button.disabled = program.kind !== 'windows';
      button.setAttribute(
        'aria-label',
        program.kind === 'windows'
          ? `Run ${program.path}`
          : `${program.path} is a DOS program, which is not run here`
      );
      button.addEventListener('click', () => run(program));

      row.append(label, button);
      return row;
    })
  );

  if (plan && !programs.length) {
    const row = document.createElement('li');
    row.className = 'empty';
    row.textContent =
      state.archives.length || programNow()
        ? 'No programs in what was dropped.'
        : 'Drop a zip of programs to run.';
    elements.programs.replaceChildren(row);
  }

  const renamed = new Map((plan?.renamed ?? []).map((one) => [one.to, one.from]));

  elements.files.replaceChildren(
    ...(plan?.files ?? [])
      .filter((file) => !file.startsWith('C:\\WINDOWS\\'))
      .map((file) => {
        const row = document.createElement('li');
        row.textContent = renamed.has(file) ? `${file}  (was ${renamed.get(file)})` : file;
        return row;
      })
  );
}

/** The engine running, named in the header, with the way to the other. */
function renderEngine() {
  const other = document.createElement('a');

  other.href = rust ? '?engine=ts' : '?engine=rust';
  other.textContent = rust ? 'Use the TypeScript engine' : 'Use the Rust engine';

  /* What the machine wrote kept before the page is left for the other's. */
  other.addEventListener('click', async (event) => {
    event.preventDefault();
    await keepAll();
    location.assign(other.href);
  });
  elements.engine.replaceChildren(
    rust
      ? 'Rust engine (WebAssembly). '
      : unbuilt
        ? 'TypeScript engine: the Rust engine is not built (pnpm build:web). '
        : 'TypeScript engine. ',
    other
  );
}

/**
 * An asset bundle taken in place of what Windows the page had, and
 * remembered; why it could not be kept, where it could not. What programs
 * wrote against another Windows goes with it.
 */
async function takeAssets(name: string, bytes: Uint8Array) {
  const assets = await Assets.fromZip(bytes);
  const same = !state.windows && state.assets?.id === assets.id;

  if (!same) {
    await Promise.all([forgetAllChanges(), forgetPrograms()]);
    kept = { installation: null, changes: [] };
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
interface Accepting {
  /** Their File System Access handles, where the browser gave them, matched by name. */
  handles?: unknown[];

  /** A drive's row they were dropped on, to go in its set. */
  into?: string | null;

  /** Whether they were given as drives -- added, or chosen again -- and so are no media for the maker. */
  drives?: boolean;
}

/** The known media's files, read once. */
let knownFiles: Promise<KnownFiles> | null = null;

/**
 * Files dropped or chosen. A disk or CD image (`imageKind`) is a drive
 * beside Windows (`kb/topics/drives-and-disks.md`, "The page's drives"),
 * mounted on the machine as it is, with nothing else made afresh; it is
 * the user's Windows 3.1 setup disk for the asset maker only where there is
 * no Windows yet, or it is one of the media WinBox knows (`isKnownMedia`).
 * An image a kept program asked for again is taken for it. Anything else
 * is read as before (`classify`).
 */
async function accept(
  files: File[],
  { handles: given = [], into = null, drives = false }: Accepting = {}
) {
  if (!files.length) {
    return;
  }

  status(`Reading ${files.map((file) => file.name).join(', ')}…`);

  const handleOf = (file: File) =>
    given.find((handle: any) => handle?.kind === 'file' && handle?.name === file.name) ?? null;
  const images: Taken[] = [];
  const rest: { file: File; bytes: Uint8Array }[] = [];
  const read: Read[] = [];
  let filled = false;
  let classified: Awaited<ReturnType<typeof classify>>[];
  let paired: string[] = [];

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
    Boolean(baseNow()) ||
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
      knownFiles ??= import('../../scripts/assets/known-media.json').then(
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
          ? await addToDrive(into, asDrives)
          : await mountTaken(asDrives)
        : []),
    ];

    render();

    if (filled) {
      await mountNeeded();
      await mediaChanged();
      said.push(
        state.needed.some((one) => !one.disk) ? 'More images are asked for.' : 'Every image is had.'
      );
    }

    status(said.join(' ') || 'Ready.');
    return;
  }

  /* What the machine wrote kept, against the Windows it ran. */
  await hold();

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
          note = await takeAssets(file.name, bytes);
          break;
        case 'installation': {
          const installation = await identify({ name: file.name, bytes });

          /* What programs wrote on another installation is not put on this one. */
          if (installation !== state.installation) {
            await Promise.all([forgetAllChanges(), forgetPrograms()]);
            kept = { installation: null, changes: [] };
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

        note = await takeAssets('winbox-assets.zip', made.zip);
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
      if (installerOf(archive.entries) && baseNow()) {
        state.offer = archive;
        state.driveOffer = null;
        state.installing = null;
        offered = offerText(archive);
        continue;
      }

      note = (await takeProgram(archive)) ?? note;
    }

    if (asDrives.length || paired.length) {
      const said = [
        ...paired,
        ...(asDrives.length
          ? into
            ? await addToDrive(into, asDrives)
            : await mountTaken(asDrives)
          : []),
      ];

      offered ??= said.join(' ');
    }

    if (filled) {
      await mountNeeded();
    }
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
    rebuilding = false;
    return;
  }

  renderDisplays();

  if (await rebuild({ keeping: false })) {
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
async function takeProgram(archive: Archive) {
  const loose = () => {
    state.archives = [...state.archives.filter((one) => one.name !== archive.name), archive];
    state.program = null;
  };
  const base = baseNow();

  if (!base) {
    loose();
    return null;
  }

  const display = elements.display.value;
  const name = archive.name.replace(/\.zip$/i, '');
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
    layers: [id],
    exes: made.programs,
    orders: { [id]: made.order },
    kept: Date.now(),
    media: mediaNow(),
  };

  /* What a program of this name wrote on a stack since changed: put on
   * the new one, or forgotten, as the user says. */
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
    await rememberImages(program);
  } catch (error: any) {
    loose();
    return `${archive.name} could not be kept in this browser, and is on C: until the page is left: ${error?.message ?? error}`;
  }

  stacks.set(name, [made.layer]);
  state.programs = [...state.programs.filter((one) => one.name !== name), program];
  state.archives = state.archives.filter((one) => one.name !== archive.name);
  state.program = name;
  return null;
}

/** Every program kept forgotten, with what they wrote: they were made on a Windows now gone. */
async function forgetPrograms() {
  await forgetAllPrograms();
  state.programs = [];
  state.program = null;
  state.offer = null;
  state.driveOffer = null;
  state.installing = null;
  state.needed = [];
  stacks.clear();
}

/* ---- the drives of images ---- */

/**
 * Handles on the images' files, by their keys (`imageKey`), where the
 * browser gave one -- a File System Access handle, Chromium's -- for a kept
 * program to remember (`rememberImages`) rather than a copy of the file.
 */
const handles = new Map<string, unknown>();

/** The Windows programs on each drive's disk, by its letter, as the page read them (`programsOn`). */
const drivePrograms = new Map<string, Program[]>();

/** An image read from a file dropped or chosen: its disk, kind and handle. */
interface Taken {
  disk: Disk;
  kind: ImageKind;
}

/** A file dropped or chosen, read: its bytes, and its handle where the browser gave one. */
interface Read {
  file: File;
  bytes: Uint8Array;
  handle: unknown;
}

/**
 * Cue sheets dropped or chosen whose files are not all had yet, asked for
 * by name (`renderDrives`) and taken from the files dropped or chosen next.
 */
let wanting: Wanting[] = [];

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
async function takeCues(read: Read[]) {
  const disks = new Map(read.map((one) => [diskRead(one), one]));
  const paired = pairCues([...disks.keys()], wanting);
  const taken: Taken[] = [];
  const said: string[] = [];

  wanting = paired.wanting;

  for (const disc of paired.discs) {
    try {
      await volumeOf('iso', disc);
      taken.push({ disk: disc, kind: 'iso' });
    } catch (error: any) {
      said.push(`${disc.name}: ${error?.message ?? error}.`);
    }
  }

  /* Said of a sheet dropped now, or given a file now: the rest were said before. */
  for (const wait of wanting.filter(
    (one) => disks.has(one.cue) || one.tracks.some((track) => track && disks.has(track))
  )) {
    said.push(`${wait.cue.name} wants ${missingOf(wait).join(', ')}: drop or choose it too.`);
  }

  const used = new Set([...paired.used].map((disk) => disks.get(disk)!));

  return { taken, used, said };
}

/** A disk made of a file read. */
const diskOf = (file: File, bytes: Uint8Array): Disk => ({
  name: file.name,
  size: file.size,
  modified: file.lastModified,
  bytes,
  written: false,
});

/** A disk's key, which tells its file again (`imageKey`). */
const keyOf = (disk: Disk) => imageKey(disk.name, disk.size, disk.modified);

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
 * installer on it is offered (`renderDrives`).
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
async function mountTaken(taken: Taken[], letters: Record<string, string> = {}) {
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
  const current = made;

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
  render();
  return said;
}

/**
 * Images dropped on a drive's row put in its set, after its disks, in
 * the order of their names; the first of them put in the drive.
 */
async function addToDrive(letter: string, taken: Taken[]) {
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

    const refused = await made?.addDisk(set, set.disks.length - 1);

    if (refused) {
      set.disks.pop();
      render();
      return [`${refused}.`];
    }
  }

  await mediaChanged();
  return [await insertDisk(letter, first)];
}

/** A drive's disk, from nought, put in it; what is said of it. */
async function insertDisk(letter: string, disk: number) {
  const set = state.drives.find((one) => one.letter === letter);

  if (!set || disk >= set.disks.length) {
    return `${letter}: has no disk ${disk + 1}.`;
  }

  const refused = made?.insert(letter, disk) ?? null;

  if (refused) {
    return `${refused}.`;
  }

  set.current = disk;
  set.ejected = false;
  await readPrograms(set);
  render();
  return `${letter}: ${setText(set)}.`;
}

/** A drive's next disk put in, the first after the last; the one after the disk taken out where it is empty. */
const nextDisk = (set: DriveSet) => insertDisk(set.letter, (set.current + 1) % set.disks.length);

/** A drive's disk taken out, the drive left empty. */
async function ejectDisk(set: DriveSet) {
  const refused = made?.eject(set.letter) ?? null;

  if (refused) {
    return `${refused}.`;
  }

  set.ejected = true;
  await readPrograms(set);
  render();
  return `${set.letter}: ${setText(set)}.`;
}

/** A drive's images let go of, and the drive with them. */
async function removeDrive(set: DriveSet) {
  made?.unmount(set.letter);
  setDrives(state.drives.filter((one) => one !== set));
  drivePrograms.delete(set.letter);

  if (state.driveOffer?.letter === set.letter) {
    state.driveOffer = null;
  }

  await mediaChanged();
  render();
  return `${set.letter}: is no more.`;
}

/**
 * The disk in a drive saved as programs have written it, as a new file
 * the browser downloads (the owner's decision 1): the image dropped is
 * never written, and is not offered to be written over.
 */
function saveImage(set: DriveSet) {
  const disk = set.disks[set.current];
  const bytes = made?.diskImage(set.letter, set.current) ?? null;

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

  const changed = made?.diskChanged(set.letter, set.current) || disk.written;

  return `${set.letter}: saved as ${name}${changed ? ', as programs wrote it' : ', as it was'}.`;
}

/**
 * The images in the drives, as a kept program remembers them: each set's
 * in order, its letter pinned; but the drive `except`.
 */
function mediaNow(except?: string): Medium[] {
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
async function rememberImages(program: KeptProgram) {
  const copy = elements.keepImages.checked;

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
async function mediaChanged() {
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
async function mountMedia(program: KeptProgram) {
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

/** The files an image asked for still wants: itself, and those its cue sheet names. */
const stillWanted = (needed: Needed) => [
  ...(needed.have ? [] : [{ name: needed.name, size: needed.size }]),
  ...(needed.tracks ?? []).filter((_, at) => !needed.trackDisks?.[at]),
];

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
async function mountNeeded() {
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
    const refused = await made?.mount(set);

    if (refused) {
      status(`${refused}.`, 'error');
      continue;
    }

    setDrives([...state.drives, set]);
    await readPrograms(set);
  }

  render();
}

/**
 * A file dropped or chosen that a kept program's image asked for is: the
 * same name and size. Taken for it, and its set mounted once it is whole.
 */
function fillNeeded(file: File, bytes: Uint8Array, handle: unknown) {
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

/** The drives, each with what may be done with it, and the images asked for. */
function renderDrives() {
  const base = baseNow();

  elements.drivesNote.textContent = state.drives.length
    ? 'Disk and CD images, read where they are, never written: what programs write to a disk is kept for the visit, and saved as a new file.'
    : 'No drives but C:. Drop disk or CD images (.img, .iso, or a .cue with its .bin files) here beside Windows, or add them: several floppies dropped together are one set, in the order of their names.';

  elements.drives.replaceChildren(
    ...state.drives.map((set) => {
      const row = document.createElement('li');
      const label = document.createElement('code');
      const actions = document.createElement('span');
      const kind = set.kind === 'iso' ? 'CD-ROM' : set.kind === 'hdd' ? 'hard disk' : 'floppy';
      const button = (text: string, aria: string, act: () => Promise<string> | string) => {
        const one = document.createElement('button');

        one.type = 'button';
        one.textContent = text;
        one.setAttribute('aria-label', aria);
        one.addEventListener('click', async () => status(await act()));
        return one;
      };

      label.textContent = `${set.letter}: ${setText(set)}`;
      label.title = kind;
      actions.className = 'actions';
      row.setAttribute('aria-label', `${set.letter}: ${kind}, ${setText(set)}`);

      if (set.disks.length > 1) {
        const pick = document.createElement('select');

        pick.setAttribute('aria-label', `Disk in ${set.letter}:`);
        pick.append(
          ...set.disks.map((disk, at) => {
            const option = document.createElement('option');

            option.value = String(at);
            option.textContent = `${at + 1}: ${disk.name}`;
            return option;
          })
        );
        pick.value = String(set.current);
        pick.addEventListener('change', async () =>
          status(await insertDisk(set.letter, Number(pick.value)))
        );
        actions.append(
          pick,
          button('Next', `Next disk in ${set.letter}:`, () => nextDisk(set))
        );
      } else if (set.ejected) {
        actions.append(button('Insert', `Insert the disk in ${set.letter}:`, () => nextDisk(set)));
      }

      if (set.kind !== 'hdd' && !set.ejected) {
        actions.append(button('Eject', `Eject ${set.letter}:`, () => ejectDisk(set)));
      }

      if (set.kind !== 'iso' && !set.ejected) {
        actions.append(
          button('Save image…', `Save the image in ${set.letter}:`, () => saveImage(set))
        );
      }

      const installer = installerOn(drivePrograms.get(set.letter) ?? []);

      if (installer && base && !state.installing) {
        actions.append(
          button('Install', `Install from ${set.letter}:`, () => offerDrive(set, installer))
        );
      }

      actions.append(button('Remove', `Remove ${set.letter}:`, () => removeDrive(set)));

      /* Images dropped on a drive go in it. */
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.add('over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('over');
        dropped(event, set.letter);
      });

      row.append(label, actions);
      return row;
    })
  );

  const needed = [
    ...state.needed
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
  ];

  elements.needed.hidden = !needed.length;
  elements.needed.replaceChildren(
    ...needed.map((one) => {
      const row = document.createElement('li');
      const label = document.createElement('code');
      const choose = document.createElement('button');
      const input = document.createElement('input');

      label.textContent = one.text;
      input.type = 'file';
      input.hidden = true;
      input.accept = one.name.slice(one.name.lastIndexOf('.'));
      input.setAttribute('aria-label', `Choose ${one.name} again`);
      input.addEventListener('change', () => accept([...(input.files ?? [])], { drives: true }));
      choose.type = 'button';
      choose.textContent = 'Choose…';
      choose.setAttribute(
        'aria-label',
        one.letter ? `Choose ${one.name} for ${one.letter}: again` : `Choose ${one.name}`
      );
      choose.addEventListener('click', () => chooseImages(input));
      row.append(label, choose, input);
      return row;
    })
  );
}

/** An installer on a drive offered to install, as an archive's is. */
function offerDrive(set: DriveSet, installer: Program) {
  const name = set.disks[0].name.replace(/\.[^.]*$/, '');

  state.offer = null;
  state.driveOffer = { letter: set.letter, installer, name };
  render();
  return `${set.letter}: holds an installer, ${installer.path}: install it.`;
}

/**
 * Images chosen to add as drives: through the browser's file picker of
 * handles where it has one (`showOpenFilePicker`, Chromium), so that a
 * kept program can be run with them again without a copy; else the
 * page's own file input.
 */
async function chooseImages(input: HTMLInputElement) {
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

    await accept(files, { drives: true, handles: chosen });
  } catch {
    /* Nothing chosen. */
  }
}

/**
 * Files dropped: with their File System Access handles, where the browser
 * gives them -- asked for at once, as a drop's items are had only while
 * its event is handled -- onto a drive's row, or the page's drop.
 */
function dropped(event: DragEvent, letter: string | null = null) {
  const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
  const asked = items.map((item) => (item as any).getAsFileSystemHandle?.() ?? null);
  const files = [...(event.dataTransfer?.files ?? [])];

  Promise.all(
    asked.map((one: Promise<unknown> | null) => (one ?? Promise.resolve(null)).catch(() => null))
  ).then((got) => accept(files, { handles: got, into: letter, drives: letter !== null }));
}
/* ---- installing ---- */

/** A program's name, as its archive names it. */
const programName = (archive: Archive) => archive.name.replace(/\.zip$/i, '');

/** The installer's file in an archive, as DOS names it: `SETUP.EXE`. */
const installerName = (archive: Archive) =>
  (installerOf(archive.entries) ?? '').split('/').pop()!.toUpperCase();

/** What the page says of an archive with an installer, dropped. */
function offerText(archive: Archive) {
  return `${archive.name} holds an installer, ${installerName(archive)}: install it, or keep it as a program.`;
}

/** The kept programs an installer may install into: those of the base and display C: is now. */
function programsHere() {
  const base = baseNow();

  return state.programs.filter(
    (program) => program.base === base && program.display === elements.display.value
  );
}

/** A name no kept program has: the name, or it numbered. */
function freeName(name: string) {
  const taken = new Set(state.programs.map((program) => program.name));

  for (let number = 2; taken.has(name); number++) {
    if (!taken.has(`${name} ${number}`)) {
      return `${name} ${number}`;
    }
  }

  return name;
}

/**
 * An archive with an installer, run: its archive put on C: as its media,
 * at `C:\WBSETUP`, over the stack of the program chosen to install into,
 * or the base alone, with an empty top; and its installer started there.
 * What it writes is kept only once its task has ended, and the user says
 * so (`keepInstalled`).
 */
async function install() {
  if (state.driveOffer) {
    return installFromDrive(state.driveOffer);
  }

  const archive = state.offer;
  const installer = archive && installerOf(archive.entries);

  if (!archive || !installer) {
    return;
  }

  const into = elements.installInto.value || null;
  const media: Archive = { name: `${MEDIA}.zip`, entries: archive.entries };

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
    renderInstall();
    return;
  }

  /* Its installer where the plan put it, under an 8.3 name. */
  const placed = plan?.placements.find(
    (placement) => placement.original === `${media.name}/${installer}`
  );
  const program = plan?.programs.find(
    (one) => placed && one.kind === 'windows' && one.parts.join('\\') === placed.parts.join('\\')
  );

  if (!program) {
    status(`${installerName(archive)} is not a Windows program, and is not run here.`, 'error');
    return;
  }

  state.installing.installer = program.path;
  renderInstall();
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
  const into = elements.installInto.value || null;
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
    renderInstall();
    return;
  }

  renderInstall();
  await run(offer.installer, { install: true });
}

/**
 * A program has ended, or asked Windows to end: once the engine has done
 * with it, where none is left running, the installer's task has ended --
 * not a program it started and waits for -- and what it wrote may be kept.
 */
function installerEnded() {
  setTimeout(() => {
    const installing = state.installing;

    if (!installing || installing.ended || !made?.idle()) {
      return;
    }

    installing.ended = true;
    renderInstall();
    status('The installer has ended. Keep what it installed, or discard it.');
  }, 0);
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
async function keepInstalled() {
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
        name: freeName(installing.name),
        base,
        display: elements.display.value,
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
async function discardInstall() {
  await hold({ keeping: false });
  state.installing = null;

  if (await rebuild({ keeping: false })) {
    status('Discarded what the installer wrote.');
  }
}

/** The archive with an installer kept as it is, a program of its own, as any archive is. */
async function keepAsProgram() {
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

/** The offer to install, or the installer running, shown with what may be done. */
function renderInstall() {
  const { offer, driveOffer, installing } = state;
  const offered = offer ?? driveOffer;

  elements.installSection.hidden = !offered && !installing;
  elements.installTarget.hidden = !offered;
  elements.install.hidden = !offered;
  elements.keepAsProgram.hidden = !offer;
  elements.installKeep.hidden = !installing?.ended;
  elements.installDiscard.hidden = !installing;

  if (offered) {
    const chosen = elements.installInto.value;
    const into = programsHere();
    const name = offer ? programName(offer) : driveOffer!.name;

    elements.installNote.textContent = offer
      ? `${offer.name} holds an installer, ${installerName(offer)}. Installed, what it writes ` +
        'on C: is kept as a layer, and its setup files let go of; or the archive is kept as it is.'
      : `${driveOffer!.letter}: holds an installer, ${driveOffer!.installer.path}. Installed, ` +
        'what it writes on C: is kept as a layer; its disks are not kept with it.';
    elements.installInto.replaceChildren(
      ...[
        { value: '', text: `as ${freeName(name)}, a program of its own` },
        ...into.map((program) => ({ value: program.name, text: `into ${program.name}` })),
      ].map(({ value, text }) => {
        const option = document.createElement('option');

        option.value = value;
        option.textContent = text;
        return option;
      })
    );
    elements.installInto.value = into.some((program) => program.name === chosen) ? chosen : '';
  } else if (installing) {
    elements.installNote.textContent = installing.ended
      ? `The installer has ended. Keep what it installed${installing.into ? ` into ${installing.into}` : ''} as a layer, or discard it.`
      : installing.drive
        ? `Installing ${installing.name} from ${installing.from}, run as ${installing.installer}.`
        : `Installing ${installing.name} from ${installing.from}: its setup files are at C:\\${MEDIA} while it runs.`;
  }
}

/** A program kept put on C:, its stack, or none: the base alone, with what was dropped loose. */
async function choose(name: string | null) {
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
async function forgetKept(name: string) {
  await hold({ keeping: state.program !== name });

  try {
    await forgetProgram(name);
  } catch (error: any) {
    rebuilding = false;
    status(`${name} could not be forgotten: ${error?.message ?? error}`, 'error');
    return;
  }

  stacks.delete(name);
  state.programs = state.programs.filter((one) => one.name !== name);

  if (state.program === name) {
    state.program = null;
    kept = { installation: null, changes: [] };
    tooLarge = [];
  }

  if (await rebuild({ keeping: false })) {
    status(`Forgot ${name}, and what it wrote.`);
  }
}

/* Handy for prodding the presenter from the browser console, and for the
 * browser test that reads a presented bitmap back. */
Object.assign(globalThis as Record<string, unknown>, { DeviceBitmap, Presenter });

function start() {
  renderEngine();

  renderDisplays();
  elements.display.value = 'vga';
  elements.display.addEventListener('change', () => {
    /* An installer runs on the display it was started on. */
    state.installing = null;
    rebuild();
  });
  elements.install.addEventListener('click', () => install());
  elements.keepAsProgram.addEventListener('click', () => keepAsProgram());
  elements.installKeep.addEventListener('click', () => keepInstalled());
  elements.installDiscard.addEventListener('click', () => discardInstall());
  elements.coprocessor.addEventListener('change', () => rebuild());

  /* Only the Rust engine has a sound card to give a machine. Windows reads
   * SYSTEM.INI as it starts, and stays up from one program to the next, so
   * the card is a setting of the machine, as the display and the
   * coprocessor are: changed, the machine is made afresh, and its first
   * program starts Windows with the card or without it. */
  elements.soundOption.hidden = !rust;
  elements.sound.addEventListener('change', async () => {
    (await engine).sound = elements.sound.checked;
    rebuild();
  });

  elements.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.drop.classList.add('over');
  });
  elements.drop.addEventListener('dragleave', () => elements.drop.classList.remove('over'));
  elements.drop.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.drop.classList.remove('over');
    dropped(event);
  });
  elements.picker.addEventListener('change', () => accept([...(elements.picker.files ?? [])]));

  /* Images added as drives, and copies of a kept program's kept, where asked for. */
  elements.chooseImages.addEventListener('click', () => chooseImages(elements.imagePicker));
  elements.imagePicker.addEventListener('change', () => {
    accept([...(elements.imagePicker.files ?? [])], { drives: true });
    elements.imagePicker.value = '';
  });
  elements.keepImages.addEventListener('change', () => {
    const program = programNow();

    if (program) {
      rememberImages(program);
    }
  });

  /* What programs wrote was written on the installation, or the bundle's
   * base, and goes with it. */
  elements.forget.addEventListener('click', async () => {
    await hold({ keeping: false });

    const what = state.windows ? 'the Windows installation' : 'the asset bundle';
    const had = state.programs.length;

    await forgetPrograms();
    state.windows = null;
    state.installation = null;
    state.assets = null;
    state.media = [];
    kept = { installation: null, changes: [] };
    tooLarge = [];
    await Promise.all([forgetWindows(), forgetAssets(), forgetAllChanges()]);
    renderDisplays();

    if (await rebuild({ keeping: false })) {
      status(
        had
          ? `Forgot ${what}, the programs kept on it, and what programs wrote.`
          : `Forgot ${what}, and what programs wrote.`
      );
    }
  });

  elements.forgetChanges.addEventListener('click', async () => {
    await hold({ keeping: false });

    const identity = identityNow();

    kept = { installation: identity, changes: [] };
    tooLarge = [];
    await forgetChanges(identity);

    if (await rebuild({ keeping: false })) {
      status('Forgot what programs wrote.');
    }
  });

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

      renderDisplays();

      /* What was kept is put back only on what it was written on. */
      const identity = identityNow();

      kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };

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
        return plan;
      },
      get engine() {
        return made;
      },
      get session() {
        return made?.session;
      },
      get kept() {
        return kept;
      },
      keptCounts,
      imageCounts,
      keep: keepAll,
      accept,
      run,
    },
  });
}

start();
