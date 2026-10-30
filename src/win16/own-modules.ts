'use strict';

import { redirect as commdlgRedirect } from './commdlg/index.js';
import { Ddeml } from './ddeml/index.js';
import { freed as ddemlFreed } from './ddeml/exports.js';
import { LzExpand } from './lzexpand/index.js';
import { OleCli } from './olecli/index.js';
import { Ver } from './ver/index.js';

/**
 * The libraries WinBox keeps whose file is loaded beside them when there is
 * one, each import of an export WinBox answers linked to WinBox's stub
 * (`linker.ts`, `GetProcAddress`): `COMMDLG` (`commdlg/`), `VER` (`ver/`),
 * `LZEXPAND` (`lzexpand/`), `DDEML` (`ddeml/`) and `OLECLI` (`olecli/`). As
 * `crates/winbox-win16/src/own_modules.rs`.
 */
const OTHERS: Record<string, any> = { VER: Ver, LZEXPAND: LzExpand, DDEML: Ddeml, OLECLI: OleCli };

/** The names of those libraries. */
export const OWN_WITH_FILE = ['COMMDLG', 'VER', 'LZEXPAND', 'DDEML', 'OLECLI'];

/**
 * Those of them kept only once a program loads one, not as Windows starts:
 * `OLECLI` (`olecli/`). A kept module takes two descriptors, so one kept
 * as Windows starts moves every selector a program is given after; kept
 * as it is first loaded, a session that never loads it is as before.
 */
const ON_LOAD: Record<string, any> = { OLECLI: OleCli };

/**
 * One of `ON_LOAD` by its module's name or its file's (`OLECLI.DLL`), kept
 * now if it is not yet, before its file is looked for or loaded -- so the
 * file's library, if there is one, is registered after it under the same
 * name, as `DDEML.DLL`'s is after WinBox's `DDEML`. What its file does as
 * it starts is done as a program first calls it (`olecli/start.ts`). As
 * `own_modules::keep_on_load`.
 */
export function keepOnLoad(system: any, name: string) {
  const own = String(name ?? '')
    .toUpperCase()
    .replace(/\.DLL$/, '');
  const module = ON_LOAD[own];

  if (module && !system._moduleData?.[own]) {
    system.keep(module, 'moveable');
  }
}

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

/**
 * One of these whose file was loaded, let go: its library gone, and with it
 * its data segment, which WinBox's own stands for. DDEML's starts again from
 * its file's data when loaded again (`ddewep`). As `own_modules::freed`.
 */
export function ownFreed(system: any, name: string) {
  if (String(name ?? '').toUpperCase() === 'DDEML') {
    ddemlFreed(system);
  }

  /* `OLECLI`'s data goes with it: its documents' list and what it did as
   * it started, done again as it is next loaded and called. */
  if (String(name ?? '').toUpperCase() === 'OLECLI') {
    delete system._olecli;
  }
}
