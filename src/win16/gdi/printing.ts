'use strict';

import { clearPage, deliver, type PrintJob } from '../printer.js';
import { HDC, INT } from '../types.js';

/**
 * A document printed: `StartDoc`, `StartPage`, `EndPage`, `EndDoc`,
 * `AbortDoc` and `SetAbortProc`, and the escapes that came before them.
 * **Recorded** by `printing`, with Windows' PostScript driver printing to a
 * file, for what does not depend on the driver:
 *
 * * Every call of a document printed succeeds, by the calls and by the
 *   escapes `STARTDOC`, `NEWFRAME` and `ENDDOC`, and the file is written.
 * * Before `StartDoc`, `StartPage` answers 1, `EndPage` -1 and `EndDoc` 1;
 *   after `AbortDoc`, `EndPage` -1 and `EndDoc` 1.
 * * The abort procedure is called as the document is written, each time
 *   with the printer's device context and nought. How often is the
 *   driver's; winbox.js's printer calls it as each page and the document are
 *   written.
 *
 * Only winbox.js's own printer prints (`printer.ts`); a device context of
 * anything else answers -1 to `StartDoc`, which is not recorded.
 */

const SP_ERROR = -1;

function printerOf(system: any, hdc: number) {
  const surface = system.handles.resolve(hdc);

  return surface?.printer ? surface : null;
}

async function callAbort(system: any, hdc: number, surface: any) {
  const proc = surface.printer.abortProc;

  if (proc) {
    await system.scheduler.callProc(
      proc,
      [
        [hdc, HDC],
        [0, INT],
      ],
      system.scheduler.stackRegisters()
    );
  }
}

export function SetAbortProc(this: any, hdc: number, lpAbortProc: number) {
  const surface = printerOf(this, hdc);

  if (!surface) {
    return SP_ERROR;
  }

  surface.printer.abortProc = lpAbortProc >>> 0;

  return 1;
}

function startDoc(system: any, surface: any, name: string) {
  surface.printer.job = {
    name,
    port: surface.printer.port,
    started: true,
    pageOpen: false,
    pages: [],
  } satisfies PrintJob;
  clearPage(surface);

  return 1;
}

export function StartDoc(this: any, hdc: number, lpdi: number) {
  const surface = printerOf(this, hdc);

  if (!surface) {
    return SP_ERROR;
  }

  let name = '';

  if (lpdi) {
    const core = this.machine.cpu.core;
    const segment = (lpdi >>> 16) & 0xffff;
    const offset = lpdi & 0xffff;
    const far =
      (core.read16(segment, (offset + 2) & 0xffff) |
        (core.read16(segment, (offset + 4) & 0xffff) << 16)) >>>
      0;

    for (let at = 0; far && at < 255; at++) {
      const byte = core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);

      if (!byte) {
        break;
      }

      name += String.fromCharCode(byte);
    }
  }

  return startDoc(this, surface, name);
}

/** Answers 1 whether or not a document is being printed (`printing`). */
export function StartPage(this: any, hdc: number) {
  const surface = printerOf(this, hdc);

  if (!surface) {
    return SP_ERROR;
  }

  const job: PrintJob | null = surface.printer.job;

  if (job) {
    clearPage(surface);
    job.pageOpen = true;
  }

  return 1;
}

/** The page drawn, kept; -1 with no document (`printing`). */
export async function EndPage(this: any, hdc: number) {
  const surface = printerOf(this, hdc);
  const job: PrintJob | null = surface?.printer.job ?? null;

  if (!surface || !job) {
    return SP_ERROR;
  }

  job.pages.push(new Uint8Array(surface.bitmap.indices));
  job.pageOpen = false;
  clearPage(surface);
  await callAbort(this, hdc, surface);

  return 1;
}

/** The document handed on; 1 with none (`printing`). */
export async function EndDoc(this: any, hdc: number) {
  const surface = printerOf(this, hdc);
  const job: PrintJob | null = surface?.printer.job ?? null;

  if (!surface) {
    return SP_ERROR;
  }

  if (!job) {
    return 1;
  }

  /* A page drawn and not ended goes with it, as the escape `ENDDOC` has it
   * after the last `NEWFRAME`. */
  if (job.pageOpen) {
    job.pages.push(new Uint8Array(surface.bitmap.indices));
  }

  surface.printer.job = null;
  await callAbort(this, hdc, surface);
  await deliver(this, surface, job);

  return 1;
}

/** The document dropped, nothing handed on. */
export function AbortDoc(this: any, hdc: number) {
  const surface = printerOf(this, hdc);

  if (!surface) {
    return SP_ERROR;
  }

  surface.printer.job = null;
  clearPage(surface);

  return 1;
}

/**
 * The escapes a printer takes that came before the calls: `NEWFRAME`, 1,
 * ends a page and starts the next; `ABORTDOC`, 2; `SETABORTPROC`, 9, its
 * procedure in the input; `STARTDOC`, 10, the document's name in the input;
 * `ENDDOC`, 11. Answers undefined for any other.
 */
export async function printerEscape(
  system: any,
  hdc: number,
  escape: number,
  count: number,
  lpIn: number
) {
  const surface = printerOf(system, hdc);

  if (!surface) {
    return undefined;
  }

  switch (escape) {
    case 1: {
      const job: PrintJob | null = surface.printer.job;

      if (!job) {
        return SP_ERROR;
      }

      job.pageOpen = true;
      const ended = await EndPage.call(system, hdc);

      job.pageOpen = true;

      return ended;
    }

    case 2:
      return AbortDoc.call(system, hdc);

    case 9:
      return SetAbortProc.call(system, hdc, lpIn);

    case 10: {
      const core = system.machine.cpu.core;
      let name = '';

      for (let at = 0; lpIn && at < count; at++) {
        name += String.fromCharCode(
          core.read8((lpIn >>> 16) & 0xffff, ((lpIn & 0xffff) + at) & 0xffff)
        );
      }

      const started = startDoc(system, surface, name);

      surface.printer.job.pageOpen = true;

      return started;
    }

    case 11: {
      const job: PrintJob | null = surface.printer.job;

      /* The escapes' last page is the one `NEWFRAME` left open; with
       * nothing drawn on it since, there is no page to add. */
      if (job) {
        job.pageOpen = false;
      }

      return EndDoc.call(system, hdc);
    }
  }

  return undefined;
}
