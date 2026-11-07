/**
 * A group's item chosen in the launcher's menu, run (`kb/guides/launcher.md`,
 * "Running an item"): on its install's machine (design A) -- the one
 * running its stack, shown, the item started beside what runs there; else
 * a machine of its own made in a new tab and shown, as opening a kept
 * program makes one (`open`: its images mounted or asked for again, the
 * display it is bound to) -- given what Program Manager's File Open gives
 * it (`PROGMAN.EXE` seg5 `03e7`, `01b3`; recorded by `pmitem`): the program
 * `ShellExecute` and `WinExec` find for its command, a document's by its
 * association, with the rest of the command line, in its working directory
 * made upper case -- the Windows directory where it has none or it is not
 * there -- and shown minimized (7) where the item says, else normally (1).
 * What each is was worked out as the launcher's list was read (`itemRun`,
 * `src/layers/launch.ts`).
 */

import { type Program } from '../drive.js';
import { keptGroups } from './groups.js';
import { open } from './install.js';
import { programOf, publish, state, status } from './state.js';

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

  /* Its install's machine, shown: the one running it, or one made. */
  const machine = await open(install);

  if (!machine || programOf(machine)?.name !== install) {
    return;
  }

  const path = run.program;
  const planned = machine.plan?.programs.find((one) => one.path === path);
  const started: Program = planned ?? {
    path,
    parts: path.slice(3).split('\\'),
    kind: 'windows',
  };

  if (started.kind !== 'windows') {
    status(`${path} is a DOS program, which is not run here.`, 'error', machine);
    return;
  }

  await (
    await machine.engine
  ).run(started, {
    item: {
      commandLine: run.commandLine,
      directory: run.directory && run.directoryThere ? run.directory : WINDOWS,
      show: run.show,
    },
  });
}
