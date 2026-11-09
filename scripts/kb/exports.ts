/**
 * Every export of every Win16 module WinBox declares, as the knowledge
 * base's pages are built from them.
 *
 * The Rust engine's `crates/winbox-win16/src/kept.rs` is the one list of what
 * each library exports: by ordinal, each export's name, the bytes of
 * arguments it pops and whether anything but the module's stub answers it.
 * `crates/winbox-win16/tests/exports.rs` writes it out as
 * `kb/data/winbox-exports.json`, and fails where the committed file differs
 * from what the engine links, so a page can never disagree with it -- and the
 * knowledge base's build, and the pre-commit hook that runs it, read a file
 * rather than run the engine.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExportEntry {
  /** The ordinal the module exports it at. */
  ordinal: number;

  /** The exported name, as the table spells it. */
  name: string;

  /** The bytes of arguments the table says it pops, if it says. */
  argumentBytes: number | null;

  /** Whether anything but the module's stub answers the call, or, for a
   * constant, whether the table gives its number. */
  implemented: boolean;

  /** A function a program calls, a number it reads where its relocation
   * puts it -- an entry of segment FEh in the module's file, as KERNEL's
   * `__AHINCR` and `__A000H` are -- or a place it reads, as `THHOOK` is
   * (`exported_data.rs`). */
  kind: 'function' | 'constant' | 'data';
}

export interface ModuleEntry {
  /** The module's name as Windows knows it: `GDI`, `KERNEL`. */
  name: string;

  /** Where Windows keeps the file. */
  path: string;

  /** Whether the module ships with Windows 3.1 or was added to it later. */
  addOn: boolean;

  /** Its exports in ordinal order, unused ordinals left out. */
  exports: ExportEntry[];
}

/** The tables, as the Rust engine's test writes them. */
export const EXPORTS_FILE = join('kb', 'data', 'winbox-exports.json');

/** WinG is the 1994 add-on for fast graphics and is marked as one. */
const ADD_ONS = new Set(['WING']);

/**
 * The modules, in the order an index lists them -- the three the system is
 * built on first, then the libraries in the order a Windows 3.1 installation
 * carries them -- which is the order the file has them in.
 */
export function collectExports(root = '.'): ModuleEntry[] {
  const { modules } = JSON.parse(readFileSync(join(root, EXPORTS_FILE), 'utf8')) as {
    modules: Omit<ModuleEntry, 'addOn'>[];
  };

  return modules.map((module) => ({ ...module, addOn: ADD_ONS.has(module.name) }));
}
