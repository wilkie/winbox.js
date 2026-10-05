/**
 * The page for running real Windows 3.1 programs: drop zip archives on it, and
 * it puts them on a C: drive and offers every Windows program on it to run.
 *
 * A zip of a Windows installation gives the programs Windows' own fonts and
 * files; it is found by what it holds and remembered in this browser, so it is
 * dropped once. Nothing is uploaded anywhere. Each program's API calls are
 * traced as it runs -- the functions it needed, and which of those reached
 * nothing -- which is what testing a real program against this implementation
 * and the oracle's recordings starts from.
 *
 * The page is the same whichever engine runs the programs (`engines/`): the
 * TypeScript engine, by default, or the Rust engine built for WebAssembly, at
 * `run.html?engine=rust`, once `pnpm build:web` has built it.
 *
 * Served by `pnpm dev` at `/run.html`. Not part of the distributed bundle.
 */

import { DISPLAY_MODES } from '../win16/display-modes.js';
import { DeviceBitmap } from '../raster/device-bitmap.js';
import { Presenter } from '../raster/presenter.js';
import { readZip } from '../zip.js';
import { type Archive, type Plan, planDrive, type Program } from './drive.js';
import { type Engine, type Page } from './engines/engine.js';
import { TypeScriptEngine } from './engines/ts.js';
import { forgetWindows, recallWindows, rememberWindows } from './store.js';
import './run.css';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const elements = {
  engine: $<HTMLElement>('#engine'),
  drop: $<HTMLElement>('#drop'),
  picker: $<HTMLInputElement>('#picker'),
  windows: $<HTMLElement>('#windows'),
  forget: $<HTMLButtonElement>('#forget'),
  display: $<HTMLSelectElement>('#display'),
  coprocessor: $<HTMLInputElement>('#coprocessor'),
  programs: $<HTMLElement>('#programs'),
  files: $<HTMLElement>('#files'),
  desktop: $<HTMLElement>('#desktop'),
  counts: $<HTMLElement>('#counts'),
  recent: $<HTMLElement>('#recent'),
  status: $<HTMLElement>('#status'),
};

/** What has been dropped: program archives, and at most one Windows installation. */
const state: { archives: Archive[]; windows: Archive | null } = { archives: [], windows: null };

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

const page: Page = { desktop: elements.desktop, status, call: trace };

/** Which engine runs the programs: the TypeScript engine, unless the page's address asks for Rust's. */
const rust = new URLSearchParams(location.search).get('engine') === 'rust';
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

engine.then((one) => (made = one));

/* ---- the drive and the machine ---- */

/**
 * The machine made afresh from what has been dropped; false, with the status
 * line saying why, where the engine could not make it.
 */
async function rebuild() {
  counts.clear();
  recent.length = 0;
  renderTrace();

  plan = planDrive(state.archives, state.windows);

  const setup = {
    plan,
    windows: state.windows,
    display: elements.display.value,
    coprocessor: elements.coprocessor.checked,
  };

  try {
    const current = await engine;

    await current.rebuild(setup);
  } catch (error: any) {
    console.error(error);
    status(`The ${engineName} engine could not start: ${error?.message ?? error}`, 'error');
    render();
    return false;
  }

  render();
  return true;
}

async function run(program: Program) {
  await (await engine).run(program);
}

/* ---- the page ---- */

function render() {
  elements.windows.textContent = state.windows
    ? `Windows installation: ${state.windows.name}${plan?.windows ? '' : ' (no SYSTEM fonts found in it)'}`
    : 'No Windows installation. Drop a zip of your own Windows 3.1 directory to give programs its fonts.';
  elements.forget.hidden = !state.windows;

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

  other.href = rust ? '?' : '?engine=rust';
  other.textContent = rust ? 'Use the TypeScript engine' : 'Try the Rust engine';
  elements.engine.replaceChildren(
    rust ? 'Rust engine (WebAssembly). ' : 'TypeScript engine. ',
    other
  );
}

async function accept(files: File[]) {
  const zips = files.filter((file) => /\.zip$/i.test(file.name));

  if (!zips.length) {
    status('Only zip archives are read here.', 'error');
    return;
  }

  status(`Reading ${zips.map((file) => file.name).join(', ')}…`);

  try {
    for (const file of zips) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const archive: Archive = { name: file.name, entries: await readZip(bytes) };

      /* An installation is recognised by its SYSTEM directory of fonts. */
      if (archive.entries.some((entry) => /(^|\/)SYSTEM\/[^/]+\.(FON|TTF)$/i.test(entry.path))) {
        state.windows = archive;
        await rememberWindows({ name: file.name, bytes });
      } else {
        state.archives = [...state.archives.filter((one) => one.name !== archive.name), archive];
      }
    }
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
    return;
  }

  if (await rebuild()) {
    status('Ready.');
  }
}

/* Handy for prodding the presenter from the browser console, and for the
 * browser test that reads a presented bitmap back. */
Object.assign(globalThis as Record<string, unknown>, { DeviceBitmap, Presenter });

function start() {
  renderEngine();

  for (const name of Object.keys(DISPLAY_MODES)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = (DISPLAY_MODES as any)[name].description;
    elements.display.append(option);
  }

  elements.display.value = 'vga';
  elements.display.addEventListener('change', () => rebuild());
  elements.coprocessor.addEventListener('change', () => rebuild());

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

  elements.forget.addEventListener('click', async () => {
    state.windows = null;
    await forgetWindows();

    if (await rebuild()) {
      status('Forgot the Windows installation.');
    }
  });

  recallWindows().then(async (remembered) => {
    if (remembered) {
      state.windows = { name: remembered.name, entries: await readZip(remembered.bytes) };
    }

    if (await rebuild()) {
      status(remembered ? `Remembered ${remembered.name}.` : 'Ready.');
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
      accept,
      run,
    },
  });
}

start();
