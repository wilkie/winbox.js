/**
 * The engine and its machine: which engine runs the programs, the page it is
 * given (`Page`), the trace of what programs call, what programs write kept
 * in this browser, and the machine made afresh from what has been dropped.
 *
 * The page is the same whichever engine runs the programs (`../engines/`):
 * the Rust engine built for WebAssembly, by default, once `pnpm build:web`
 * has built it, or the TypeScript engine, at `run.html?engine=ts` -- and
 * where the Rust engine has not been built.
 */

import { type Assets } from '../../assets/bundle.js';
import { composedDisplays } from '../../assets/compose.js';
import { type Change, sameChanges } from '../changes.js';
import { planDrive, type Program, type Stack } from '../drive.js';
import { type Engine, type Page } from '../engines/engine.js';
import { TypeScriptEngine } from '../engines/ts.js';
import { recallChanges, recallLayers, rememberChanges } from '../store.js';
import {
  counts,
  identityNow,
  programNow,
  publish,
  publishTrace,
  recent,
  session,
  stacks,
  state,
  status,
} from './state.js';
import { displayKept, offeredDisplays } from './view.js';

/* ---- the trace ---- */

let traceFrame = 0;

function renderTrace() {
  traceFrame = 0;
  publishTrace();
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

/* ---- the engine ---- */

const page: Page = {
  get desktop() {
    return session.desktop!;
  },
  status,
  call: trace,
  /* What a program wrote kept as it ends; an installer's, once its task
   * has ended, kept only as the user says (`keepInstalled`). */
  ended: () => {
    /* What it wrote to the drives' disks shown. */
    publish();

    return state.installing ? installerEnded() : keep();
  },
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

session.rust = rust;

/** Whether the Rust engine was wanted but not there, which the header says. */
session.unbuilt = asked === null && !rust;

const engineName = rust ? 'Rust' : 'TypeScript';

/**
 * The engine, made once. The Rust engine's module, and its glue, are only
 * loaded where it is asked for.
 */
export const engine: Promise<Engine> = rust
  ? import('../engines/rust.js').then(({ RustEngine }) => new RustEngine(page))
  : Promise.resolve(new TypeScriptEngine(page));

engine.then((one) => {
  session.made = one;
  one.sound = state.sound;
});

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
 * What programs have written on C: kept in this browser: the engine's
 * changes against the drive as planned, as they stand, written where they
 * are not what was kept last. Kept as a program ends, while the page is
 * shown every few seconds, as it is hidden or left, and before the machine
 * is made afresh. Telling them takes the engine a walk of its drive, and
 * comparing them a look at the bytes of what changed, so no frame waits
 * long on it.
 */
export function keep() {
  session.keeping ??= keepNow().finally(() => (session.keeping = null));
  return session.keeping;
}

async function keepNow() {
  const current = session.made;
  const at = session.generation;

  /* An installer's top is kept as a layer, and only on "Keep". */
  if (!current || session.rebuilding || state.installing) {
    return;
  }

  let told: Change[] | null;

  try {
    told = await current.changes();
  } catch (error) {
    console.error(error);
    return;
  }

  if (!told || at !== session.generation || session.rebuilding) {
    return;
  }

  const large = told.filter((change) => change.kind === 'file' && change.data.length > LIMIT);
  const changes = told.filter((change) => !large.includes(change));
  const skipped = large.map((change) => `C:\\${change.path}`);

  if (skipped.join() !== session.tooLarge.join()) {
    session.tooLarge = skipped;

    if (skipped.length) {
      status(`Not kept, being larger than 8 MB: ${skipped.join(', ')}.`);
    }

    publish();
  }

  if (session.kept.installation === session.built && sameChanges(changes, session.kept.changes)) {
    return;
  }

  const next = { installation: session.built, changes };

  try {
    await rememberChanges(next);
  } catch (error: any) {
    status(`What programs wrote could not be kept: ${error?.message ?? error}`, 'error');
    return;
  }

  session.kept = next;
  publish();
}

/** What the machine has written kept as it stands: told afresh, once any keeping under way is done. */
export async function keepAll() {
  await session.keeping;
  await keep();
}

/**
 * Keeping stopped until the machine is made afresh (`rebuild`), once what
 * it wrote is kept, where it is to be: what is dropped, or forgotten, is
 * then changed without a machine still running telling changes against it.
 */
export async function hold({ keeping: first = true } = {}) {
  await (first ? keepAll() : session.keeping);
  session.rebuilding = true;
  session.generation++;
}

/* ---- the drive and the machine ---- */

/**
 * The displays offered: those the asset bundle has a driver and a base for,
 * where C: is its base; every one, else. The one chosen kept where it is
 * offered, VGA else, or the first. Shown at once, as the machine made
 * after may not be.
 */
export function offerDisplays() {
  state.displays = offeredDisplays(state.windows, state.assets, composedDisplays());
  state.display = displayKept(state.displays, state.display);
  publish();
}

/**
 * The machine made afresh from what has been dropped, and what programs
 * wrote put back on it; false, with the status line saying why, where the
 * engine could not make it. What the machine it replaces has written is
 * kept first, unless it is being forgotten.
 */
export async function rebuild({ keeping = true } = {}) {
  if (keeping) {
    await keepAll();
  }

  session.generation++;
  session.rebuilding = true;
  counts.clear();
  recent.length = 0;
  renderTrace();

  /* What programs wrote against what the machine is now made from: kept
   * from before, where it was against another -- another display's base.
   * An installer runs on an empty top, with nothing kept. */
  const installing = state.installing;
  const identity = installing ? null : identityNow();

  if (!installing && session.kept.installation !== identity) {
    session.kept = (await recallChanges(identity)) ?? { installation: identity, changes: [] };
    session.tooLarge = [];
  }

  session.built = identity;

  const display = state.display;
  const assets = state.windows ? null : state.assets;
  /* An installer runs over the stack of the program it installs into. */
  const program = installing
    ? (state.programs.find((one) => one.name === installing.into) ?? null)
    : programNow();
  let composed: ReturnType<Assets['compose']> | null;

  try {
    composed = assets?.compose(display) ?? null;
  } catch (error: any) {
    session.rebuilding = false;
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
      session.rebuilding = false;
      status(`${program.name} could not be read back: ${error?.message ?? error}`, 'error');
      publish();
      return false;
    }
  }

  try {
    session.plan = planDrive(
      installing ? (installing.media ? [installing.media] : []) : program ? [] : state.archives,
      state.windows,
      composed,
      stack
    );
  } catch (error: any) {
    session.rebuilding = false;
    status(
      `${program?.name ?? 'C:'} could not be put together: ${error?.message ?? error}`,
      'error'
    );
    publish();
    return false;
  }

  const setup = {
    plan: session.plan,
    windows: state.windows,
    assets,
    display,
    coprocessor: state.coprocessor,
    changes: installing ? [] : session.kept.changes,
    drives: state.drives,
  };

  try {
    const current = await engine;

    /* What programs wrote to the disks of the machine made last kept,
     * for this one to be given. */
    current.carry();
    session.given = setup.changes;
    await current.rebuild(setup);
  } catch (error: any) {
    console.error(error);
    status(`The ${engineName} engine could not start: ${error?.message ?? error}`, 'error');
    publish();
    return false;
  } finally {
    session.rebuilding = false;
  }

  publish();
  return true;
}

/** A program run; an installer as Windows runs one, Program Manager the shell starting it. */
export async function run(program: Program, options: { install?: boolean } = {}) {
  await (await engine).run(program, options);
}

/**
 * A program has ended, or asked Windows to end: once the engine has done
 * with it, where none is left running, the installer's task has ended --
 * not a program it started and waits for -- and what it wrote may be kept.
 */
export function installerEnded() {
  setTimeout(() => {
    const installing = state.installing;

    if (!installing || installing.ended || !session.made?.idle()) {
      return;
    }

    installing.ended = true;
    publish();
    status('The installer has ended. Keep what it installed, or discard it.');
  }, 0);
}
