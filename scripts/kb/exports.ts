/**
 * Every export of every Win16 module winbox.js declares, as the knowledge
 * base's pages are built from them.
 *
 * The export tables in `src/win16/<module>.ts` are the one list of what each
 * library exports: an array indexed by ordinal, each entry the function that
 * answers the call (or the module's stub), its name, the bytes of arguments it
 * pops and, where it is implemented, its argument and return types. Reading
 * the tables through the modules themselves, rather than parsing the source,
 * means a page can never disagree with what the emulator actually links.
 */

import { CommDlg } from '../../src/win16/commdlg.js';
import { Gdi } from '../../src/win16/gdi.js';
import { Kernel } from '../../src/win16/kernel.js';
import { MMSystem } from '../../src/win16/mmsystem.js';
import { Sound } from '../../src/win16/sound.js';
import { User } from '../../src/win16/user.js';
import { Win87EM } from '../../src/win16/win87em.js';
import { WinG } from '../../src/win16/wing.js';

export interface ExportEntry {
  /** The ordinal the module exports it at. */
  ordinal: number;

  /** The exported name, as the table spells it. */
  name: string;

  /** The bytes of arguments the table says it pops, if it says. */
  argumentBytes: number | null;

  /** Whether anything but the module's stub answers the call. */
  implemented: boolean;

  /** The implementing function's own name, where it has one. */
  implementation: string | null;
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

/**
 * The modules, in the order an index lists them: the three the system is built
 * on first, then the libraries in the order a Windows 3.1 installation carries
 * them. WinG is the 1994 add-on for fast graphics and is marked as one.
 */
const MODULES: [any, boolean][] = [
  [Kernel, false],
  [User, false],
  [Gdi, false],
  [CommDlg, false],
  [MMSystem, false],
  [Sound, false],
  [Win87EM, false],
  [WinG, true],
];

export function collectExports(): ModuleEntry[] {
  return MODULES.map(([module, addOn]) => {
    const table: any[] = module.exports ?? [];
    const exports: ExportEntry[] = [];

    table.forEach((entry, ordinal) => {
      if (!entry || typeof entry[1] !== 'string') {
        return;
      }

      const [implementation, name, argumentBytes] = entry;
      const implemented = typeof implementation === 'function' && implementation !== module.stub;

      exports.push({
        ordinal,
        name,
        argumentBytes: typeof argumentBytes === 'number' ? argumentBytes : null,
        implemented,
        implementation: implemented ? implementation.name || null : null,
      });
    });

    return { name: module.name, path: module.path, addOn, exports };
  });
}
