'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRINT_TO_FILE_DIALOG } from '../../src/win16/user/print-to-file.js';
import { FIND_PROGRAM_DIALOG } from '../../src/win16/shell/find-program.js';
import { parseDialogTemplate } from '../../src/win16/user/dialog-template.js';

/**
 * USER's "Print To File" box (its dialog 10) and SHELL's "Program Not Found"
 * (its dialog 200) are laid out from named constants, none of Windows'
 * bytes in the source. Where the oracle installation has the files, each
 * template is compared with the file's resource; with no file, skipped. As
 * the Rust engine's `print_to_file.rs` and `shell/find_program.rs` tests.
 */

const SYSTEM = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM');
const USER = join(SYSTEM, 'USER.EXE');
const SHELL = join(SYSTEM, 'SHELL.DLL');

describe("USER's and SHELL's own dialogs", () => {
  it('read back as their boxes', () => {
    const print = parseDialogTemplate((at) => PRINT_TO_FILE_DIALOG[at] ?? 0);
    const find = parseDialogTemplate((at) => FIND_PROGRAM_DIALOG[at] ?? 0);

    expect(print.caption).toBe('Print To File');
    expect(print.items.map((item: any) => item.id)).toEqual([101, 10, 1, 2]);
    expect(find.caption).toBe('Program Not Found');
    expect(find.items.map((item: any) => item.id)).toEqual([205, 206, 203, 1, 2, 201, 204]);
  });

  (existsSync(USER) ? it : it.skip)("Print To File is in USER.EXE's dialog 10", () => {
    expect(readFileSync(USER).indexOf(Buffer.from(PRINT_TO_FILE_DIALOG))).toBeGreaterThan(0);
  });

  (existsSync(SHELL) ? it : it.skip)("Program Not Found is in SHELL.DLL's dialog 200", () => {
    expect(readFileSync(SHELL).indexOf(Buffer.from(FIND_PROGRAM_DIALOG))).toBeGreaterThan(0);
  });
});
