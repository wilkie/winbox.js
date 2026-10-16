'use strict';

/** @namespace CommDlg */

import { Module } from '../module.js';
import { segmentSelector } from '../selectors.js';
import { DWORD } from '../types.js';
import { CommDlgExtendedError } from './state.js';

/**
 * `COMMDLG`, the common dialogs, made WinBox's own a function at a time.
 * As `crates/winbox-win16/src/commdlg/`.
 *
 * **How a call reaches it.** `COMMDLG` is one of the modules WinBox keeps,
 * and its file is loaded beside it when there is one (`library.ts`):
 *
 * * With `COMMDLG.DLL` on the drive, a program that imports `COMMDLG`, or
 *   loads it by its name or its whole path, gets the file's library, as on
 *   Windows -- its module handle, its instance, its count, its entry point,
 *   which registers its messages. But each import of an export WinBox
 *   answers is linked to WinBox's stub for that ordinal, not to the file's
 *   entry (`linker.ts`), and `GetProcAddress` answers the stub. The other
 *   exports are the file's code.
 * * With none, the program links to WinBox's stubs throughout: an export
 *   WinBox answers is answered, one it does not yet answers nought, as
 *   every stub does. `LoadLibrary` finds it by its file's name whether or
 *   not the file is there, and the messages its entry point would have
 *   registered are registered as it loads (`start`).
 *
 * The extended error is one word for both: the file's own, while the file
 * is loaded, and WinBox's otherwise (`state.ts`).
 *
 * **Adding a function** -- the registration point is this table, one entry
 * per ordinal:
 *
 * 1. Write it in a file of this folder.
 * 2. Put it in place of `CommDlg.stub` at its ordinal below, with the bytes
 *    of arguments it pops, its arguments' types and its answer's type.
 * 3. In the Rust engine, add its arm to `implementation` in
 *    `crates/winbox-win16/src/commdlg/mod.rs`.
 * 4. Write `kept.rs` again (`npm run rust:modules`): the export is then no
 *    longer a stub there, and the Rust test `commdlg::tests::ours_agree`
 *    checks the two engines answer the same exports.
 *
 * The ordinals and names are `COMMDLG.DLL`'s entry table's; 3, 4, 10, 17
 * and 24 it has no entry for, and 32 on are entries it does not export by
 * name.
 *
 * @memberof Win16
 */
export class CommDlg extends Module {
  static get name(): string {
    return 'COMMDLG';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL';
  }

  static get exports() {
    return [
      // 0 // "Common Windows Dialogs, Ver 3.10"
      null,
      [CommDlg.stub, 'GetOpenFileName', 4],
      [CommDlg.stub, 'GetSaveFileName', 4],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'ChooseColor', 4],
      [CommDlg.stub, 'FileOpenDlgProc', 10],
      [CommDlg.stub, 'FileSaveDlgProc', 10],
      [CommDlg.stub, 'ColorDlgProc', 10],
      [CommDlg.stub, 'LoadAlterBitmap', 10],
      // 10 //
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'FindText', 4],
      [CommDlg.stub, 'ReplaceText', 4],
      [CommDlg.stub, 'FindTextDlgProc', 10],
      [CommDlg.stub, 'ReplaceTextDlgProc', 10],
      [CommDlg.stub, 'ChooseFont', 4],
      [CommDlg.stub, 'FormatCharDlgProc', 10],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'FontStyleEnumProc', 14],
      [CommDlg.stub, 'FontFamilyEnumProc', 14],
      // 20 //
      [CommDlg.stub, 'PrintDlg', 4],
      [CommDlg.stub, 'PrintDlgProc', 10],
      [CommDlg.stub, 'PrintSetupDlgProc', 10],
      [CommDlg.stub, 'EditIntegerOnly', 10],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'WantArrows', 10],
      [CommDlgExtendedError, 'CommDlgExtendedError', 0, [], DWORD],
      [CommDlg.stub, 'GetFileTitle', 10],
      [CommDlg.stub, 'WEP', 2],
      [CommDlg.stub, 'dwLBSubclass', 10],
      // 30 //
      [CommDlg.stub, 'dwUpArrowHack', 10],
      [CommDlg.stub, 'dwOKSubclass', 10],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 6],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 10],
      [CommDlg.stub, 'Unknown', 12],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 6],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 10],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/** Whether WinBox answers an ordinal of `COMMDLG`'s. */
export function ours(ordinal: number) {
  const entry = CommDlg.exports[ordinal];

  return !!entry && entry[0] !== CommDlg.stub;
}

/**
 * What an import of an ordinal of a module loaded from its file links to,
 * and what `GetProcAddress` answers for it, where it is not the file's
 * entry: WinBox's stub, for an export of `COMMDLG` WinBox answers. Null
 * for any other.
 */
export function redirect(modules: any, loader: any, ordinal: number) {
  if (String(loader?.name ?? '').toUpperCase() !== 'COMMDLG' || !ours(ordinal)) {
    return null;
  }

  return modules.load(CommDlg).lookup(ordinal) as { segment: number; offset: number };
}

/**
 * The far address of an export of `COMMDLG`'s that WinBox answers -- its
 * stub, which USER calls as it calls any procedure of a program's, and
 * which lands in the function this table names. COMMDLG hands out its own
 * exports so: `FileOpenDlgProc` to `DialogBoxIndirectParam` (`COMMDLG.DLL`
 * seg2 `0c2d`), `dwLBSubclass` to `SetWindowLong` (seg2 `18be`). Nought for
 * an ordinal it does not answer.
 */
export function procAddress(system: any, ordinal: number): number {
  if (!ours(ordinal)) {
    return 0;
  }

  const info = system._modules.load(CommDlg).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}
