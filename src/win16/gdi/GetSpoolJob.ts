'use strict';

import { readQueues, readied, spoolerOf } from './spooler.js';

/**
 * `GetSpoolJob`: GDI's own interface to Print Manager, an option and a
 * parameter over the spooler's state (`spooler.ts`, `spoolerOf`).
 *
 * **Read out** of `GDI.EXE` (seg28 `1802`, a table of options 14h to 23h
 * at `1821`) and **recorded** by `spooljob` on an installation with no
 * printer, in the order Print Manager asks as it starts -- 1Dh, 19h, 14h,
 * 15h -- and then the options that only read, and by `gdispool`, which
 * stands in for Print Manager with a printer of its own:
 *
 * * 14h hands the spooler a buffer, which it fills with the next job's
 *   details: with no printer, 42 bytes of nought. It answers nought.
 * * 15h takes Print Manager's window (`[058Eh]`), nought for none, and
 *   answers how many jobs there are (`[0592h]`): nought. Taking nought
 *   forgets the disk space 1Bh gave.
 * * 19h readies the spooler's queues from `[PrinterPorts]` where they are
 *   not (`[0590h]`), as the first job does, and answers how many there are
 *   (`[0A28h]`). 1Ch reads them again whether or not, and answers nought;
 *   1Dh answers how many; 1Fh lets them be readied afresh.
 * * 1Bh keeps the disk space Print Manager has (`[058Ah]`, a long), which
 *   `QueryJob`'s 1004h asks after. 20h and 21h answer the two timeouts of
 *   a queue, by its number, in milliseconds: the second number after its
 *   port and the first. 22h answers 1 while Print Manager has given no
 *   window, else nought. 23h sets or clears a flag. Every other option
 *   answers nought.
 *
 * Not followed: Print Manager's jobs, which option 14h would describe; a
 * queue's timeouts asked by a number past the queues, which GDI reads
 * from what its table last held there.
 */

/** What option 14h writes: a job's details, all nought with none. */
const JOB_DETAILS = 42;

/**
 * @param {Types.UINT} wOption - What to do.
 * @param {Types.LONG} lParam - Its parameter.
 *
 * @returns {Types.LONG} The option's answer.
 */
export async function GetSpoolJob(this: any, wOption: number, lParam: number) {
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
        spooler.diskSpace = 0;
      }

      return spooler.jobs;

    case 0x19:
      await readied(this);
      return spooler.queues;

    case 0x1b:
      spooler.diskSpace = lParam >>> 0;
      return 0;

    case 0x1c:
      await readQueues(this);
      return 0;

    case 0x1d:
      return spooler.queues;

    case 0x1f:
      spooler.started = false;
      return 0;

    case 0x20:
    case 0x21: {
      const queue = this._spooling?.queues[(lParam << 16) >> 16];

      return (queue ? (wOption & 0xffff) === 0x20 ? queue.retry : queue.select : 0) >>> 0;
    }

    case 0x22:
      return spooler.window ? 0 : 1;

    case 0x23:
      spooler.flagged = lParam !== 0;
      return 0;

    default:
      return 0;
  }
}
