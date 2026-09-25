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
 * Served by `pnpm dev` at `/run.html`. Not part of the distributed bundle.
 */

import { DOS } from '../dos.js';
import { Executable } from '../executable.js';
import { Machine } from '../emulator/machine.js';
import { Space } from '../space.js';
import { Win16 } from '../win16.js';
import { DISPLAY_MODES } from '../win16/display-modes.js';
import { Presenter } from '../raster/presenter.js';
import { readZip } from '../zip.js';
import {
  type Archive,
  buildDrive,
  displayDriverOf,
  type Drive,
  type Program,
  systemFileOf,
} from './drive.js';
import { forgetWindows, recallWindows, rememberWindows } from './store.js';
import '../../css/main.scss';
import './run.css';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const elements = {
  drop: $<HTMLElement>('#drop'),
  picker: $<HTMLInputElement>('#picker'),
  windows: $<HTMLElement>('#windows'),
  forget: $<HTMLButtonElement>('#forget'),
  display: $<HTMLSelectElement>('#display'),
  raster: $<HTMLInputElement>('#raster'),
  programs: $<HTMLElement>('#programs'),
  files: $<HTMLElement>('#files'),
  desktop: $<HTMLElement>('#desktop'),
  counts: $<HTMLElement>('#counts'),
  recent: $<HTMLElement>('#recent'),
  status: $<HTMLElement>('#status'),
};

/** What has been dropped: program archives, and at most one Windows installation. */
const state: { archives: Archive[]; windows: Archive | null } = { archives: [], windows: null };

/** The machine the programs run on, rebuilt whenever the drive changes. */
let session: { machine: any; win16: any; drive: Drive } | null = null;

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

function trace(call: any) {
  const name = `${call.module}.${call.name}`;
  const entry = counts.get(name) ?? { count: 0, stub: !!call.stub };

  entry.count++;
  counts.set(name, entry);

  recent.push(`${name}(${(call.args ?? []).map((arg: any) => formatArg(arg)).join(', ')})`);

  if (recent.length > 200) {
    recent.shift();
  }

  traceFrame ||= requestAnimationFrame(renderTrace);

  if (call.name === 'ExitWindows') {
    status('The program asked Windows to end the session, and has finished.');
  }
}

function formatArg(arg: any) {
  if (arg === null || arg === undefined) {
    return 'NULL';
  }

  if (arg instanceof String || typeof arg === 'string') {
    return JSON.stringify(String(arg));
  }

  if (typeof arg === 'number') {
    return arg > 9 ? `0x${(arg >>> 0).toString(16)}` : String(arg);
  }

  return typeof arg === 'object' ? '{…}' : String(arg);
}

function status(message: string, kind: 'info' | 'error' = 'info') {
  elements.status.textContent = message;
  elements.status.className = kind;
}

/* ---- the drive and the machine ---- */

async function rebuild() {
  counts.clear();
  recent.length = 0;
  renderTrace();

  const machine = new Machine();
  const drive = await buildDrive(machine, state.archives, state.windows);

  elements.desktop.replaceChildren();

  const space = new Space({ title: 'Windows' });
  space.open(elements.desktop);

  /* With the installation's display driver, windows are USER's own, drawn on
   * one screen from the driver's bitmaps; without it, the page's components
   * stand in. */
  const driver = state.windows && elements.raster.checked ? displayDriverOf(state.windows) : null;

  const win16: any = new Win16(new DOS(machine), machine, space, {
    display: elements.display.value,
    onCall: trace,
    onError: (error: any) => {
      console.error(error);
      status(`Stopped: ${error?.message ?? error}`, 'error');
    },
    ...(driver ? { raster: { driver, user: systemFileOf(state.windows!, 'USER.EXE') } } : {}),
  });

  if (drive.windows) {
    await win16.boot();
  }

  if (driver && drive.windows) {
    const screen = win16.rasterDesktop.screen;
    const canvas = document.createElement('canvas');

    canvas.width = screen.width;
    canvas.height = screen.height;
    canvas.className = 'screen';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The Windows screen');
    elements.desktop.replaceChildren(canvas);
    new Presenter(screen, canvas);
    attachInput(canvas, win16.rasterInput);
  }

  session = { machine, win16, drive };
  render();
}

async function run(program: Program) {
  if (!session) {
    return;
  }

  status(`Running ${program.path}…`);

  try {
    const file = await session.drive.fileSystem.open(program.parts);
    const name = program.parts[program.parts.length - 1].replace(/\.EXE$/, '');
    const executable: any = new Executable(name, program.path, file);

    await executable.parse();

    const handle = await session.win16.load(executable);
    session.win16.link(handle);
    session.win16.run(handle);

    status(`${program.path} is running.`);
  } catch (error: any) {
    status(`${program.path} stopped: ${error?.message ?? error}`, 'error');
  }
}

/**
 * The screen's canvas as Windows' mouse and keyboard: a pointer's place, in
 * the screen's pixels however large the canvas is drawn, and each key, handed
 * to the raster desktop's input. The canvas takes the keyboard when it is
 * clicked, and keeps the keys it is given from the page.
 */
function attachInput(canvas: HTMLCanvasElement, input: any) {
  canvas.tabIndex = 0;

  const at = (event: MouseEvent) => {
    const box = canvas.getBoundingClientRect();

    return {
      x: Math.floor(((event.clientX - box.left) * canvas.width) / box.width),
      y: Math.floor(((event.clientY - box.top) * canvas.height) / box.height),
      button: event.button,
      buttons: event.buttons,
      double: event.detail === 2,
      shift: event.shiftKey,
      control: event.ctrlKey,
    };
  };

  canvas.addEventListener('mousedown', (event) => {
    canvas.focus();
    event.preventDefault();
    input.pointer('down', at(event));
  });
  canvas.addEventListener('mouseup', (event) => input.pointer('up', at(event)));
  canvas.addEventListener('mousemove', (event) => input.pointer('move', at(event)));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const key = (kind: 'down' | 'up') => (event: KeyboardEvent) => {
    event.preventDefault();
    input.key(kind, {
      code: event.code,
      key: event.key,
      repeat: event.repeat,
      alt: event.altKey,
    });
  };

  canvas.addEventListener('keydown', key('down'));
  canvas.addEventListener('keyup', key('up'));
}

/* ---- the page ---- */

function render() {
  elements.windows.textContent = state.windows
    ? `Windows installation: ${state.windows.name}${session?.drive.windows ? '' : ' (no SYSTEM fonts found in it)'}`
    : 'No Windows installation. Drop a zip of your own Windows 3.1 directory to give programs its fonts.';
  elements.forget.hidden = !state.windows;

  const drive = session?.drive;

  elements.programs.replaceChildren(
    ...(drive?.programs ?? []).map((program) => {
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

  if (drive && !drive.programs.length) {
    const row = document.createElement('li');
    row.className = 'empty';
    row.textContent = state.archives.length
      ? 'No programs in what was dropped.'
      : 'Drop a zip of programs to run.';
    elements.programs.replaceChildren(row);
  }

  const renamed = new Map((drive?.renamed ?? []).map((one) => [one.to, one.from]));

  elements.files.replaceChildren(
    ...(drive?.files ?? [])
      .filter((file) => !file.startsWith('C:\\WINDOWS\\'))
      .map((file) => {
        const row = document.createElement('li');
        row.textContent = renamed.has(file) ? `${file}  (was ${renamed.get(file)})` : file;
        return row;
      })
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

    await rebuild();
    status('Ready.');
  } catch (error: any) {
    status(`Could not read that: ${error?.message ?? error}`, 'error');
  }
}

function start() {
  for (const name of Object.keys(DISPLAY_MODES)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = (DISPLAY_MODES as any)[name].description;
    elements.display.append(option);
  }

  elements.display.value = 'vga';
  elements.display.addEventListener('change', () => rebuild());
  elements.raster.addEventListener('change', () => rebuild());

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
    await rebuild();
    status('Forgot the Windows installation.');
  });

  recallWindows().then(async (remembered) => {
    if (remembered) {
      state.windows = { name: remembered.name, entries: await readZip(remembered.bytes) };
    }

    await rebuild();
    status(remembered ? `Remembered ${remembered.name}.` : 'Ready.');
  });

  /* Handy for prodding the machine from the browser console. */
  Object.assign(globalThis as Record<string, unknown>, {
    winbox: {
      state,
      get session() {
        return session;
      },
      accept,
      run,
    },
  });
}

start();
