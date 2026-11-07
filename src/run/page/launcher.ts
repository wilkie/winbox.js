/**
 * A group's item chosen in the launcher's menu, run (`kb/guides/launcher.md`,
 * "Running an item"): its install's stack made C: as choosing a kept
 * program makes it (`choose`: its images mounted or asked for again, the
 * display it is bound to), unless C: is that stack already, the machine
 * running it; then the item started on that machine, given what Program
 * Manager's File Open gives it (`PROGMAN.EXE` seg5 `03e7`, `01b3`; recorded
 * by `pmitem`): the program `ShellExecute` and `WinExec` find for its
 * command, a document's by its association, with the rest of the command
 * line, in its working directory made upper case -- the Windows directory
 * where it has none or it is not there -- and shown minimized (7) where the
 * item says, else normally (1). What each is was worked out as the
 * launcher's list was read (`itemRun`, `src/layers/launch.ts`).
 */

import { type Program } from '../drive.js';
import { keptGroups } from './groups.js';
import { choose } from './install.js';
import { engine } from './machine.js';
import { programNow, publish, session, state, status } from './state.js';

/** The Windows directory, current where an item's working directory is not there (seg5 `03f5`). */
const WINDOWS = 'C:\\WINDOWS';

/** A group's item run, by its program's name, its group's place and its own in the launcher's list. */
export async function launch(install: string, group: number, item: number) {
  const program = state.programs.find((one) => one.name === install);
  const chosen = program && keptGroups(program, state, publish)?.groups[group]?.items[item];

  if (!program || !chosen) {
    return;
  }

  const run = chosen.run;

  if (run.reason || !run.program) {
    status(`${chosen.name} cannot be run: ${run.reason ?? 'its program is not found'}.`, 'error');
    return;
  }

  /* On its install's stack, on the display it is bound to; the machine
   * running it already kept as it is, the item started beside what runs. */
  if (programNow()?.name !== install || state.installing || session.rebuilding) {
    if (!state.displays.includes(program.display)) {
      status(`${install} was made on a display this Windows does not offer.`, 'error');
      return;
    }

    state.display = program.display;
    publish();
    await choose(install);

    if (programNow()?.name !== install) {
      return;
    }
  }

  const path = run.program;
  const planned = session.plan?.programs.find((one) => one.path === path);
  const started: Program = planned ?? {
    path,
    parts: path.slice(3).split('\\'),
    kind: 'windows',
  };

  if (started.kind !== 'windows') {
    status(`${path} is a DOS program, which is not run here.`, 'error');
    return;
  }

  await (
    await engine
  ).run(started, {
    item: {
      commandLine: run.commandLine,
      directory: run.directory && run.directoryThere ? run.directory : WINDOWS,
      show: run.show,
    },
  });
}
