'use strict';

import { FALSE, TRUE } from '../consts.js';

const HELP_QUIT = 0x0002;

/**
 * Asks Windows Help to show a help file, or tells it the help is no longer
 * needed.
 *
 * Measured by the `winhelp` probe: with Help not running, `HELP_QUIT` succeeds
 * -- there is nothing to close -- and Notepad, which asks it as it closes,
 * does not close when it fails. Anything else would start `WINHELP.EXE`, which
 * starting another program is not yet done for, and fails.
 */
export function WinHelp(this: any, hwnd: number, lpszHelpFile: any, fuCommand: number) {
  return (fuCommand & 0xffff) === HELP_QUIT ? TRUE : FALSE;
}
