'use strict';

import { redirect as commdlgRedirect } from './commdlg/index.js';
import { LzExpand } from './lzexpand/index.js';
import { Ver } from './ver/index.js';

/**
 * The libraries WinBox keeps whose file is loaded beside them when there is
 * one, each import of an export WinBox answers linked to WinBox's stub
 * (`linker.ts`, `GetProcAddress`): `COMMDLG` (`commdlg/`), `VER` (`ver/`)
 * and `LZEXPAND` (`lzexpand/`). As `crates/winbox-win16/src/own_modules.rs`.
 */
const OTHERS: Record<string, any> = { VER: Ver, LZEXPAND: LzExpand };

/** The names of those libraries. */
export const OWN_WITH_FILE = ['COMMDLG', 'VER', 'LZEXPAND'];

/** Whether WinBox answers an ordinal of one of `OTHERS`. */
function answered(module: any, ordinal: number) {
  const entry = module.exports[ordinal];

  return !!entry && entry[0] !== module.stub;
}

/**
 * What an import of an ordinal of a library loaded from its file links to,
 * and what `GetProcAddress` answers for it, where it is not the file's
 * entry: WinBox's stub, for an export WinBox answers. Null for any other.
 */
export function redirect(modules: any, loader: any, ordinal: number) {
  const name = String(loader?.name ?? '').toUpperCase();
  const module = OTHERS[name];

  if (!module) {
    return commdlgRedirect(modules, loader, ordinal);
  }

  if (!answered(module, ordinal)) {
    return null;
  }

  return modules.load(module).lookup(ordinal) as { segment: number; offset: number };
}

/** The path of the file of one of these, as WinBox keeps it. */
export function ownPath(name: string): string | null {
  return OTHERS[name]?.path ?? null;
}

/** The library of these whose file has this name (`VER.DLL`), if one does. */
export function ownByFile(file: string) {
  const name = file.toUpperCase().replace(/\.DLL$/, '');

  return OWN_WITH_FILE.includes(name) && file.toUpperCase().endsWith('.DLL') ? name : null;
}
