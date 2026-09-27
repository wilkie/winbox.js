'use strict';

/**
 * `GetSpoolJob`: GDI's own interface to Print Manager, an option and a
 * parameter over the spooler's state.
 *
 * **Read out** of `GDI.EXE` (seg28 `1802`) and **recorded** by `spooljob` on
 * an installation with no printer, in the order Print Manager asks as it
 * starts -- 1Dh, 19h, 14h, 15h -- and then the options that only read:
 *
 * * 14h hands the spooler a buffer, which it fills with the next job's
 *   details: with no printer, 42 bytes of nought. It answers nought.
 * * 15h takes Print Manager's window, nought for none, and answers how many
 *   jobs there are: nought. Taking nought forgets the procedure 1Bh gave.
 * * 19h readies the spooler's queues from the printers the first time, and
 *   answers how many: nought. 1Ch readies them again, and answers nought;
 *   1Dh answers how many; 1Fh lets them be readied afresh.
 * * 1Bh keeps a procedure. 20h and 21h answer the two timeouts of a queue,
 *   by its number: nought with none. 22h answers 1 while Print Manager has
 *   given no window, else nought. 23h sets or clears a flag. Every other
 *   option answers nought.
 *
 * Not followed: printers, their queues and their jobs, of which winbox.js
 * has none; the queues' timeouts, which GDI reads from `[PrinterPorts]`.
 */

/** What option 14h writes: a job's details, all nought with none. */
const JOB_DETAILS = 42;

interface Spooler {
  started: boolean;
  window: number;
  procedure: number;
  queues: number;
  jobs: number;
  flagged: boolean;
}

function spoolerOf(system: any): Spooler {
  return (system._spooler ??= {
    started: false,
    window: 0,
    procedure: 0,
    queues: 0,
    jobs: 0,
    flagged: false,
  });
}

/**
 * @param {Types.UINT} wOption - What to do.
 * @param {Types.LONG} lParam - Its parameter.
 *
 * @returns {Types.LONG} The option's answer.
 */
export function GetSpoolJob(this: any, wOption: number, lParam: number) {
  const spooler = spoolerOf(this);

  switch (wOption & 0xffff) {
    case 0x14: {
      const core = this.machine.cpu.core;

      for (let i = 0; i < JOB_DETAILS; i++) {
        core.write8((lParam >>> 16) & 0xffff, ((lParam & 0xffff) + i) & 0xffff, 0);
      }

      return 0;
    }

    case 0x15:
      spooler.window = lParam & 0xffff;

      if (!spooler.window) {
        spooler.procedure = 0;
      }

      return spooler.jobs;

    case 0x19:
      if (!spooler.started) {
        spooler.started = true;
        spooler.queues = 0;
      }

      return spooler.queues;

    case 0x1b:
      spooler.procedure = lParam >>> 0;
      return 0;

    case 0x1c:
      spooler.queues = 0;
      return 0;

    case 0x1d:
      return spooler.queues;

    case 0x1f:
      spooler.started = false;
      return 0;

    case 0x22:
      return spooler.window ? 0 : 1;

    case 0x23:
      spooler.flagged = lParam !== 0;
      return 0;

    default:
      return 0;
  }
}
