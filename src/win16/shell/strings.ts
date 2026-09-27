'use strict';

/**
 * SHELL's strings, by their resource numbers: the About box's lines, the
 * registration database's name, and the messages of finding a program.
 * winbox.js keeps them itself, as it keeps SHELL: no Windows file is shipped.
 * Made to match the Windows 3.1 the recordings are made on by
 * `scripts/oracle/strings-table.mjs`.
 */
export const SHELL_STRINGS: ReadonlyMap<number, string> = new Map([
  [0x0d0, 'REG.DAT'],
  [0x0d1, 'Real Mode'],
  [0x0d2, 'Real Mode (Large Frame EMS)'],
  [0x0d3, 'Real Mode (Small Frame EMS)'],
  [0x0d4, 'Standard Mode'],
  [0x0d5, '386 Enhanced Mode'],
  [0x0d7, 'System Resources:'],
  [0x0d8, 'Version %s %s'],
  [0x0d9, '(Debug)'],
  [0x0da, '%s KB Free'],
  [0x0db, '%s KB Free (%s KB in EMS)'],
  [0x0dc, '%d%% Free'],
  [0x0df, "Cannot find file '%s'."],
  [0x0e0, '(found)'],
  [0x0e1, '(not found)'],
  [0x0e2, 'Cannot load COMMDLG.DLL'],
  [0x0e3, '\r\nSHELL.DLL: RegCloseKey called with no corresponding RegOpenKey'],
]);
