'use strict';

import { segmentSelector } from '../selectors.js';
import { GetProfileInt } from './GetProfileInt.js';
import { instructionLength } from './instruction-length.js';
import { sysErrorBox, SEB_CLOSE, SEB_DEFBUTTON, SEB_IGNORE } from '../user/sys-error-box.js';

/**
 * A program that faults, as KERNEL takes it (`KRNL386.EXE` seg1 `5e1b`),
 * **read out** and **recorded** by `fault` through the screen.
 *
 * * If the instruction can be stepped over, the first box offers the
 *   choice: Ignore steps over it and the program goes on; Close goes on to
 *   the second. It is offered while `WIN.INI`'s `[KERNEL] GPContinue`,
 *   1 when it is not there, has its lowest bit set, the stack pointer is
 *   80h or more, and the instruction is one KERNEL knows the length of.
 * * The second box, Application Error, says which fault, in which module,
 *   at which segment of it and where; `SetErrorMode`'s
 *   `SEM_NOGPFAULTERRORBOX` shows none. Then the program is ended, with
 *   exit code FFh.
 *
 * Nothing else runs while either box is up. Not followed: Dr. Watson,
 * a debugger's Cancel, and a fault in KERNEL's or USER's own code, which
 * winbox.js has none of.
 */

/** What each fault is called, as KERNEL writes it. */
const FAULTS: Record<number, string> = {
  0x06: 'an Illegal Instruction',
  0x0c: 'a Stack Fault',
  0x0d: 'a General Protection Fault',
};

const FIRST_BOX =
  'An error has occurred in your application.\n' +
  'If you choose Ignore, you should save your work in a new file.\n' +
  'If you choose Close, your application will terminate.';

const SEM_NOGPFAULTERRORBOX = 0x0002;

/**
 * Handles a fault in the task that has the processor: whether it is to go on
 * (Ignore), or has been ended.
 */
export async function applicationFault(system: any, vector: number): Promise<boolean> {
  const handle = system.scheduler.active;
  const task = handle ? system.handles.resolve(handle) : null;

  if (!task?.executable) {
    return false;
  }

  const core = system.machine.cpu.core;
  const faulted = core._instruction ?? {};
  const cs = faulted.startCs ?? core.cs;
  const ip = faulted.startIp ?? core.ip;

  /* The registers as they were when the instruction began. */
  core.cs = cs;
  core.ip = ip;

  const name = String(task.executable.name ?? '')
    .toUpperCase()
    .slice(0, 8);

  if (vector === 0x0d && (await canIgnore(system, cs, ip))) {
    const chosen = await sysErrorBox(system, FIRST_BOX, name, [
      SEB_CLOSE | SEB_DEFBUTTON,
      0,
      SEB_IGNORE,
    ]);

    if (chosen === 3) {
      core.ip = (ip + (instructionLength((at) => core.read8(cs, ip + at)) ?? 0)) & 0xffff;
      return true;
    }
  }

  if (!((system._errorMode ?? 0) & SEM_NOGPFAULTERRORBOX)) {
    const { number, file } = placeOf(system, task, cs);
    const hex = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');
    const text =
      `${name} caused ${FAULTS[vector] ?? 'an Application Fault'} in\n` +
      `module ${file} at ${hex(number)}:${hex(ip)}.\n\n` +
      `Choose close. ${name} will close.`;

    await sysErrorBox(system, text, 'Application Error', [0, SEB_CLOSE | SEB_DEFBUTTON, 0]);
  }

  system.exitTask(0xff);

  return false;
}

/** Whether the first box is offered (seg1 `9ff7`). */
async function canIgnore(system: any, cs: number, ip: number) {
  const setting = await GetProfileInt.call(system, 'KERNEL', 'GPContinue', 1);

  if (!(setting & 1) || system.machine.cpu.core.sp < 0x80 || ip + 10 > 0xffff) {
    return false;
  }

  try {
    return instructionLength((at) => system.machine.cpu.core.read8(cs, ip + at)) !== null;
  } catch {
    return false;
  }
}

/**
 * The module a code selector is in and which of its segments, counted from
 * 1; the selector itself when it is none of them, and `<unknown>` for the
 * module (seg1 `5d38`).
 */
function placeOf(system: any, task: any, cs: number) {
  const modules = [task, ...(task.libraries ?? [])];

  for (const module of modules) {
    const loader = module?.loader;
    const segments = loader?.segments ?? [];

    for (let index = 0; index < segments.length; index++) {
      if ((segmentSelector(loader.translate(index + 1)) & 0xfff8) === (cs & 0xfff8)) {
        const path = String(module.executable?.path ?? '');

        return { number: index + 1, file: path.slice(path.search(/[^\\/:]*$/)).toUpperCase() };
      }
    }
  }

  return { number: cs, file: '<unknown>' };
}
