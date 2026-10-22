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
 * for the display chosen, with no installation at all. What programs write on C: is remembered too, as the changes
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
import { type Archive, type Plan, planDrive, type Program } from './drive.js';
import { type Engine, type Page } from './engines/engine.js';
import { TypeScriptEngine } from './engines/ts.js';
import { classify, makeFromMedia } from './media.js';
import {
  assetsIdentity,
  forgetAllChanges,
  forgetAssets,
  forgetChanges,
  forgetWindows,
  identify,
  type Kept,
  recallAssets,
  recallChanges,
  recallWindows,
  rememberAssets,
  rememberChanges,
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
} = {
  archives: [],
  windows: null,
  installation: null,
  assets: null,
  media: [],
};

/**
 * What the changes programs write are told against: the installation, or
 * the asset bundle and the display, whose base differs with the display
 * (`assetsIdentity`); null with neither.
 */
function identityNow() {
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
  }
}

function status(message: string, kind: 'info' | 'error' = 'info') {
  elements.status.textContent = message;
  elements.status.className = kind;
}

/* ---- the engine ---- */

const page: Page = { desktop: elements.desktop, status, call: trace, ended: () => keep() };

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

  if (!current || rebuilding) {
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
   * from before, where it was against another -- another display's base. */
  const identity = identityNow();

  if (kept.installation !== identity) {
    kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };
    tooLarge = [];
  }

  built = identity;

  const display = elements.display.value;
  const assets = state.windows ? null : state.assets;

  try {
    plan = planDrive(state.archives, state.windows, assets?.compose(display) ?? null);
  } catch (error: any) {
    rebuilding = false;
    status(`The asset bundle has no base for that display: ${error?.message ?? error}`, 'error');
    return false;
  }

  const setup = {
    plan,
    windows: state.windows,
    assets,
    display,
    coprocessor: elements.coprocessor.checked,
    changes: kept.changes,
  };

  try {
    const current = await engine;

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

async function run(program: Program) {
  await (await engine).run(program);
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

function render() {
  elements.windows.textContent = windowsText();
  elements.forget.hidden = !state.windows && !state.assets;
  renderChanges();

  elements.programs.replaceChildren(
    ...(plan?.programs ?? []).map((program) => {
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

  if (plan && !plan.programs.length) {
    const row = document.createElement('li');
    row.className = 'empty';
    row.textContent = state.archives.length
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
    await forgetAllChanges();
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

async function accept(files: File[]) {
  if (!files.length) {
    return;
  }

  status(`Reading ${files.map((file) => file.name).join(', ')}…`);

  /* What the machine wrote kept, against the Windows it ran. */
  await hold();

  let note: string | null = null;

  try {
    const media: AssetInput[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dropped = await classify(file.name, bytes);

      switch (dropped.kind) {
        case 'bundle':
          note = await takeAssets(file.name, bytes);
          break;
        case 'installation': {
          const installation = await identify({ name: file.name, bytes });

          /* What programs wrote on another installation is not put on this one. */
          if (installation !== state.installation) {
            await forgetAllChanges();
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
        case 'programs': {
          const archive: Archive = { name: file.name, entries: dropped.entries };

          state.archives = [...state.archives.filter((one) => one.name !== archive.name), archive];
          break;
        }
      }
    }

    /* The disks made into a bundle here, as `pnpm assets` makes one. */
    if (media.length) {
      status(`Making the asset bundle from ${media.map((one) => one.name).join(', ')}…`);

      const made = await bundleFrom(media);

      note = await takeAssets('winbox-assets.zip', made.zip);
    }
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
    rebuilding = false;
    return;
  }

  renderDisplays();

  if (await rebuild({ keeping: false })) {
    status(note ?? 'Ready.', note ? 'error' : 'info');
  }
}

/* Handy for prodding the presenter from the browser console, and for the
 * browser test that reads a presented bitmap back. */
Object.assign(globalThis as Record<string, unknown>, { DeviceBitmap, Presenter });

function start() {
  renderEngine();

  renderDisplays();
  elements.display.value = 'vga';
  elements.display.addEventListener('change', () => rebuild());
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
    accept([...(event.dataTransfer?.files ?? [])]);
  });
  elements.picker.addEventListener('change', () => accept([...(elements.picker.files ?? [])]));

  /* What programs wrote was written on the installation, or the bundle's
   * base, and goes with it. */
  elements.forget.addEventListener('click', async () => {
    await hold({ keeping: false });

    const what = state.windows ? 'the Windows installation' : 'the asset bundle';

    state.windows = null;
    state.installation = null;
    state.assets = null;
    state.media = [];
    kept = { installation: null, changes: [] };
    tooLarge = [];
    await Promise.all([forgetWindows(), forgetAssets(), forgetAllChanges()]);
    renderDisplays();

    if (await rebuild({ keeping: false })) {
      status(`Forgot ${what}, and what programs wrote.`);
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

  Promise.all([recallWindows(), recallAssets()]).then(async ([remembered, bundle]) => {
    let note: string | null = null;

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
  });

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
      keep: keepAll,
      accept,
      run,
    },
  });
}

start();
