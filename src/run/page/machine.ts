/**
 * The machines (`kb/guides/launcher.md`, design A): which engine runs the
 * programs, a machine made -- an engine instance of its own, given a `Page`
 * of its own, with its own screen, trace and drives -- shown, and closed;
 * what its programs write kept in this browser; and a machine made afresh
 * from what has been dropped.
 *
 * The programs run on the Rust engine built for WebAssembly
 * (`../engines/rust.ts`), once `pnpm build:web` has built it; where it has
 * not been built, the page says so and makes no machine.
 */

import { type Assets } from '../../assets/bundle.js';
import { composedDisplays } from '../../assets/compose.js';
import { type Change, sameChanges } from '../changes.js';
import { planDrive, type Program, type Stack } from '../drive.js';
import { type Engine, type Page } from '../engines/engine.js';
import { type WindowsMode } from '../windows-mode.js';
import { recallChanges, recallLayers, rememberChanges } from '../store.js';
import {
  current,
  FIRST_DISPLAY,
  identityOf,
  type Machine,
  machines,
  programOf,
  publish,
  publishTrace,
  session,
  show,
  stacks,
  state,
  status,
} from './state.js';
import { displayKept, offeredDisplays, shownAfterClosing } from './view.js';

/* ---- the trace ---- */

/** A machine's trace shown, where it is the machine shown. */
function renderTrace(machine: Machine) {
  machine.traceFrame = 0;

  if (machine === current()) {
    publishTrace();
  }
}

/** A call a machine's program made, counted and kept among its most recent. */
function trace(machine: Machine, name: string, stub: boolean, line: string) {
  const entry = machine.counts.get(name) ?? { count: 0, stub };

  entry.count++;
  machine.counts.set(name, entry);

  machine.recent.push(line);

  if (machine.recent.length > 200) {
    machine.recent.shift();
  }

  machine.traceFrame ||= requestAnimationFrame(() => renderTrace(machine));

  if (name === 'USER.ExitWindows') {
    status('The program asked Windows to end the session, and has finished.', 'info', machine);

    /* An installer that ends Windows has ended. */
    if (machine.installing) {
      installerEnded(machine);
    }
  }
}

/* ---- the engine ---- */

/** What a machine's engine is given: its own screen's place, the status line, its trace. */
function pageOf(machine: Machine): Page {
  return {
    desktop: machine.desktop,
    status: (message, kind) => status(message, kind, machine),
    call: (name, stub, line) => trace(machine, name, stub, line),
    /* What a program wrote kept as it ends; an installer's, once its task
     * has ended, kept only as the user says (`keepInstalled`). */
    ended: () => {
      /* What it wrote to the drives' disks shown. */
      publish();

      return machine.installing ? installerEnded(machine) : keep(machine);
    },
  };
}

/** Where `pnpm build:web` writes the Rust engine's module, as `pnpm dev` serves it. */
const RUST_MODULE = '/target/winbox-web/winbox_web_bg.wasm';

/** Whether the Rust engine's module has been built. */
async function engineBuilt(): Promise<boolean> {
  try {
    return (await fetch(RUST_MODULE, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/** Whether the engine is not built, which the status line says in place of a machine. */
session.unbuilt = !(await engineBuilt());

/** What the status line says where the engine is not built. */
export const UNBUILT = 'The engine is not built: run pnpm build:web, then reload this page.';

/**
 * An engine for a machine. Its module, and its glue, are only loaded once
 * the page has found it built.
 */
function makeEngine(page: Page): Promise<Engine> {
  return session.unbuilt
    ? Promise.reject(new Error(UNBUILT))
    : import('../engines/rust.js').then(({ RustEngine }) => new RustEngine(page));
}

/** Machines made, which numbers the next. */
let made = 0;

/**
 * A machine made, its tab after the others, with nothing on it yet: its
 * screen's place in the desktop, hidden until it is shown, and its engine.
 * What it runs is its `program`, on its display, once it is made afresh
 * (`rebuild`).
 */
export function addMachine({
  program = null,
  display = current()?.display ?? FIRST_DISPLAY,
  mode = current()?.mode ?? 'standard',
  coprocessor = current()?.coprocessor ?? true,
  sound = current()?.sound ?? false,
}: {
  program?: string | null;
  display?: string;
  mode?: WindowsMode;
  coprocessor?: boolean;
  sound?: boolean;
} = {}) {
  const id = ++made;
  const desktop = document.createElement('div');

  desktop.className = 'machine-screen';
  desktop.id = `machine-${id}`;
  desktop.hidden = true;
  session.desktop?.append(desktop);

  const machine: Machine = {
    id,
    program,
    display: displayKept(state.displays, display),
    mode,
    coprocessor,
    sound,
    installing: null,
    driveOffer: null,
    drives: [],
    drivePrograms: new Map(),
    driveVolumes: new Map(),
    engine: null!,
    made: null,
    built: null,
    plan: null,
    kept: { installation: null, changes: [] },
    given: [],
    tooLarge: [],
    generation: 0,
    rebuilding: false,
    keeping: null,
    closed: false,
    desktop,
    counts: new Map(),
    recent: [],
    traceFrame: 0,
  };

  machine.engine = makeEngine(pageOf(machine));
  machine.engine.then(
    (one) => {
      machine.made = one;
      one.sound = machine.sound;
      one.heard = machine === current();
    },
    /* Not built: `rebuild` says so on the status line. */
    () => {}
  );
  machines.push(machine);
  return machine;
}

/**
 * A machine shown: its tab selected, its screen shown and the others'
 * hidden, its trace and the side's panels speaking for it; and only its
 * sound heard (`Engine.heard`), as only its screen is seen.
 */
export function select(machine: Machine) {
  show(machine);

  for (const one of machines) {
    one.desktop.hidden = one !== machine;

    if (one.made) {
      one.made.heard = one === machine;
    }
  }

  publish();
  publishTrace();
}

/**
 * A machine closed: what its programs wrote kept first, as `keepNow` keeps
 * it (unless what it runs is being forgotten), then its engine ended and
 * its screen taken away; the tab beside it shown. With none left, a
 * machine on the base alone is made in its place, as the page is opened
 * with one.
 */
export async function closeMachine(machine: Machine, { keeping = true } = {}) {
  if (machine.closed) {
    return;
  }

  await hold(machine, { keeping });

  const ids = machines.map((one) => one.id);
  const next = shownAfterClosing(ids, machine.id, current().id);

  machine.closed = true;
  machines.splice(machines.indexOf(machine), 1);
  cancelAnimationFrame(machine.traceFrame);
  machine.desktop.remove();

  try {
    (await machine.engine).dispose();
  } catch (error) {
    console.error(error);
  }

  const shownNext = machines.find((one) => one.id === next);

  if (shownNext) {
    select(shownNext);
    return;
  }

  const fresh = addMachine({
    display: machine.display,
    mode: machine.mode,
    coprocessor: machine.coprocessor,
  });

  select(fresh);
  await rebuild(fresh, { keeping: false });
}

/* ---- what programs write, kept ---- */

/**
 * The largest file kept. IndexedDB has room for far more, but a program's
 * own data files are rarely this large, and one that is would be written
 * again with every save.
 */
const LIMIT = 8 * 1024 * 1024;

/** How often what programs write is kept while the page is shown, in milliseconds. */
export const EVERY = 5000;

/**
 * What a machine's programs have written on C: kept in this browser: the
 * engine's changes against the drive as planned, as they stand, written
 * where they are not what was kept last. Kept as a program ends, while the
 * page is shown every few seconds, as it is hidden or left, before the
 * machine is made afresh, and as it is closed. Telling them takes the
 * engine a walk of its drive, and comparing them a look at the bytes of
 * what changed, so no frame waits long on it.
 */
export function keep(machine: Machine) {
  machine.keeping ??= keepNow(machine).finally(() => (machine.keeping = null));
  return machine.keeping;
}

/** What every machine's programs have written kept. */
export const keepEvery = () => Promise.all(machines.map((machine) => keep(machine)));

async function keepNow(machine: Machine) {
  const current = machine.made;
  const at = machine.generation;

  /* An installer's top is kept as a layer, and only on "Keep". */
  if (!current || machine.rebuilding || machine.installing || machine.closed) {
    return;
  }

  let told: Change[] | null;

  try {
    told = await current.changes();
  } catch (error) {
    console.error(error);
    return;
  }

  if (!told || at !== machine.generation || machine.rebuilding) {
    return;
  }

  const large = told.filter((change) => change.kind === 'file' && change.data.length > LIMIT);
  const changes = told.filter((change) => !large.includes(change));
  const skipped = large.map((change) => `C:\\${change.path}`);

  if (skipped.join() !== machine.tooLarge.join()) {
    machine.tooLarge = skipped;

    if (skipped.length) {
      status(`Not kept, being larger than 8 MB: ${skipped.join(', ')}.`, 'info', machine);
    }

    publish();
  }

  if (machine.kept.installation === machine.built && sameChanges(changes, machine.kept.changes)) {
    return;
  }

  const next = { installation: machine.built, changes };

  try {
    await rememberChanges(next);
  } catch (error: any) {
    status(`What programs wrote could not be kept: ${error?.message ?? error}`, 'error', machine);
    return;
  }

  machine.kept = next;
  publish();
}

/** What a machine has written kept as it stands: told afresh, once any keeping under way is done. */
export async function keepAll(machine: Machine) {
  await machine.keeping;
  await keep(machine);
}

/**
 * A machine's keeping stopped until it is made afresh (`rebuild`), once
 * what it wrote is kept, where it is to be: what is dropped, or forgotten,
 * is then changed without a machine still running telling changes against
 * it.
 */
export async function hold(machine: Machine, { keeping: first = true } = {}) {
  await (first ? keepAll(machine) : machine.keeping);
  machine.rebuilding = true;
  machine.generation++;
}

/* ---- the drive and the machine ---- */

/**
 * The displays offered: those the asset bundle has a driver and a base for,
 * where C: is its base; every one, else. Each machine's kept where it is
 * offered, VGA else, or the first. Shown at once, as the machine made after
 * may not be.
 */
export function offerDisplays() {
  state.displays = offeredDisplays(state.windows, state.assets, composedDisplays());

  for (const machine of machines) {
    machine.display = displayKept(state.displays, machine.display);
  }

  publish();
}

/**
 * A machine made afresh from what has been dropped, and what its programs
 * wrote put back on it; false, with the status line saying why, where the
 * engine could not make it. What the machine it replaces has written is
 * kept first, unless it is being forgotten.
 */
export async function rebuild(machine: Machine, { keeping = true } = {}) {
  if (keeping) {
    await keepAll(machine);
  }

  machine.generation++;
  machine.rebuilding = true;
  machine.counts.clear();
  machine.recent.length = 0;
  renderTrace(machine);

  /* What programs wrote against what the machine is now made from: kept
   * from before, where it was against another -- another display's base.
   * An installer runs on an empty top, with nothing kept. */
  const installing = machine.installing;
  const identity = installing ? null : identityOf(machine);

  if (!installing && machine.kept.installation !== identity) {
    machine.kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };
    machine.tooLarge = [];
  }

  machine.built = identity;

  const display = machine.display;
  const assets = state.windows ? null : state.assets;
  /* An installer runs over the stack of the program it installs into. */
  const program = installing
    ? (state.programs.find((one) => one.name === installing.into) ?? null)
    : programOf(machine);
  let composed: ReturnType<Assets['compose']> | null;

  try {
    composed = assets?.compose(display) ?? null;
  } catch (error: any) {
    machine.rebuilding = false;
    status(
      `The asset bundle has no base for that display: ${error?.message ?? error}`,
      'error',
      machine
    );
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
      machine.rebuilding = false;
      status(
        `${program.name} could not be read back: ${error?.message ?? error}`,
        'error',
        machine
      );
      publish();
      return false;
    }
  }

  try {
    machine.plan = planDrive(
      installing ? (installing.media ? [installing.media] : []) : program ? [] : state.archives,
      state.windows,
      composed,
      stack
    );
  } catch (error: any) {
    machine.rebuilding = false;
    status(
      `${program?.name ?? 'C:'} could not be put together: ${error?.message ?? error}`,
      'error',
      machine
    );
    publish();
    return false;
  }

  const setup = {
    plan: machine.plan,
    windows: state.windows,
    assets,
    display,
    mode: machine.mode,
    coprocessor: machine.coprocessor,
    changes: installing ? [] : machine.kept.changes,
    drives: machine.drives,
  };

  try {
    const engine = await machine.engine;

    /* What programs wrote to the disks of the machine made last kept,
     * for this one to be given. */
    engine.carry();
    machine.given = setup.changes;

    if (!machine.closed) {
      await engine.rebuild(setup);
    }
  } catch (error: any) {
    if (!session.unbuilt) {
      console.error(error);
    }

    status(
      session.unbuilt ? UNBUILT : `The engine could not start: ${error?.message ?? error}`,
      'error',
      machine
    );
    publish();
    return false;
  } finally {
    machine.rebuilding = false;
  }

  publish();
  return true;
}

/** A program run on a machine; an installer as Windows runs one, Program Manager the shell starting it. */
export async function run(machine: Machine, program: Program, options: { install?: boolean } = {}) {
  await (await machine.engine).run(program, options);
}

/**
 * A machine's program has ended, or asked Windows to end: once the engine
 * has done with it, where none is left running, the installer's task has
 * ended -- not a program it started and waits for -- and what it wrote may
 * be kept.
 */
export function installerEnded(machine: Machine) {
  setTimeout(() => {
    const installing = machine.installing;

    if (!installing || installing.ended || !machine.made?.idle()) {
      return;
    }

    installing.ended = true;
    publish();
    status('The installer has ended. Keep what it installed, or discard it.', 'info', machine);
  }, 0);
}
