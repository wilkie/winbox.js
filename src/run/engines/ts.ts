/**
 * The TypeScript engine, the page's default: a machine and Win16 made from
 * the plan, its C: drive a FAT16 volume in memory, booted from the Windows
 * installation where one was dropped; its screen shown by a presenter, its
 * windows mirrored for a screen reader, and every program's calls traced as
 * Win16 makes them. Programs run beside one another on the one machine.
 */

import { DOS } from '../../dos.js';
import { Executable } from '../../executable.js';
import { Machine } from '../../emulator/machine.js';
import { Win16 } from '../../win16.js';
import { previousInstance } from '../../win16/kernel/WinExec.js';
import { Presenter } from '../../raster/presenter.js';
import { accessibleTree } from '../../win16/user/accessible-tree.js';
import { AriaMirror } from '../aria-mirror.js';
import { displayDriverOf, fillDrive, type Drive, type Program, systemFileOf } from '../drive.js';
import {
  attachInput,
  type Engine,
  makeScreen,
  type Page,
  screenNote,
  type Setup,
} from './engine.js';

/** An argument as the most recent calls show it. */
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

export class TypeScriptEngine implements Engine {
  readonly name = 'TypeScript';
  readonly #page: Page;

  /** The machine the programs run on, rebuilt whenever the drive changes. */
  session: { machine: any; win16: any; drive: Drive } | null = null;

  constructor(page: Page) {
    this.#page = page;
  }

  #trace = (call: any) => {
    const name = `${call.module}.${call.name}`;

    this.#page.call(
      name,
      !!call.stub,
      `${name}(${(call.args ?? []).map((arg: any) => formatArg(arg)).join(', ')})`
    );
  };

  async rebuild({ plan, windows, display, coprocessor }: Setup) {
    const page = this.#page;
    const machine = new Machine({ coprocessor });
    const drive = await fillDrive(machine, plan);

    /* Windows are USER's own, drawn on one screen from the installation's
     * display driver and fonts. Without an installation a program still runs,
     * but it makes no windows. */
    const driver = windows && drive.windows ? displayDriverOf(windows) : null;

    screenNote(page.desktop);

    const win16: any = new Win16(new DOS(machine), machine, {
      display,
      onCall: this.#trace,
      onExit: (_handle: number, code: number) => {
        page.status(`The program has ended, with exit code ${code}.`);
      },
      onError: (error: any) => {
        console.error(error);
        page.status(`Stopped: ${error?.message ?? error}`, 'error');
      },
      ...(driver ? { raster: { driver, user: systemFileOf(windows!, 'USER.EXE') } } : {}),
    });

    if (drive.windows) {
      await win16.boot();
    }

    if (driver && drive.windows) {
      const screen = win16.rasterDesktop.screen;
      const shown = makeScreen(page.desktop, screen.width, screen.height);

      new Presenter(screen, shown.canvas, win16.display);
      attachInput(shown, win16.rasterInput);
      keepMirror(new AriaMirror(shown.mirror, shown.host), win16.rasterDesktop);
    }

    this.session = { machine, win16, drive };
  }

  async run(program: Program) {
    const session = this.session;

    if (!session) {
      return;
    }

    const page = this.#page;

    page.status(`Running ${program.path}…`);

    try {
      const file = await session.drive.fileSystem.open(program.parts);
      const name = program.parts[program.parts.length - 1].replace(/\.EXE$/, '');
      const executable: any = new Executable(name, program.path, file);

      await executable.parse();

      /* A second instance of a program running is given the first as its
       * previous one, as `WinExec` gives it. */
      const previous = previousInstance(session.win16, program.path);
      const handle = await session.win16.load(executable);
      session.win16.link(handle);
      session.win16.run(handle, { previous });

      page.status(`${program.path} is running.`);
    } catch (error: any) {
      page.status(`${program.path} stopped: ${error?.message ?? error}`, 'error');
    }
  }
}

/**
 * The mirror, brought up to date with the desktop once a frame. Rebuilding
 * the tree is cheap for a screen of windows, and the mirror touches nothing
 * when it has not changed.
 */
function keepMirror(mirror: AriaMirror, desktop: any) {
  const frame = () => {
    mirror.update(accessibleTree(desktop));
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
