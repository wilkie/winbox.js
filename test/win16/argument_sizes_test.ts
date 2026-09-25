'use strict';

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CommDlg } from '../../src/win16/commdlg.js';
import { Gdi } from '../../src/win16/gdi.js';
import { Kernel } from '../../src/win16/kernel.js';
import { Keyboard } from '../../src/win16/keyboard.js';
import { MMSystem } from '../../src/win16/mmsystem.js';
import { Shell } from '../../src/win16/shell.js';
import { Sound } from '../../src/win16/sound.js';
import { User } from '../../src/win16/user.js';
import { Win87EM } from '../../src/win16/win87em.js';

/**
 * Every export takes off the stack exactly what Windows' own takes off.
 *
 * A Win16 function is called Pascal: the caller pushes the arguments and the
 * function removes them as it returns. Each export here returns by the size
 * its table gives, so a size that is wrong leaves every caller's stack wrong
 * by the difference -- a stub declared as taking nothing, called with a word,
 * returns into the word. `scripts/oracle/argument-sizes.mjs` reads the right
 * size out of the installation's own module, and this holds every table to it.
 */

const ROOT = join(__dirname, '..', '..');
const SYSTEM = join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM');
const SCRIPT = join(ROOT, 'scripts', 'oracle', 'argument-sizes.mjs');

const MODULES: [any, string][] = [
  [Kernel, 'KRNL386.EXE'],
  [User, 'USER.EXE'],
  [Gdi, 'GDI.EXE'],
  [Keyboard, 'KEYBOARD.DRV'],
  [Shell, 'SHELL.DLL'],
  [CommDlg, 'COMMDLG.DLL'],
  [MMSystem, 'MMSYSTEM.DLL'],
  [Sound, 'SOUND.DRV'],
  [Win87EM, 'WIN87EM.DLL'],
];

/**
 * Where the reading is wrong, by module and ordinal, and why.
 *
 * * `Throw` never returns to its caller. It reloads the stack from the catch
 *   buffer and returns from the `Catch` that filled it, so the `RETF` it
 *   reaches is `Catch`'s; its own two arguments are six bytes.
 * * `CreateScalableFontResource`'s check of its arguments has an error return
 *   of `RETF 0Ch`, but the function itself reads its fourth argument at
 *   `[bp+12h]` and returns by `RETF 0Eh`: the check covers the three pointers
 *   and forgets the `UINT`. Windows' own error path is two bytes short; the
 *   function is fourteen.
 */
const EXCEPTIONS: Record<string, number> = {
  'KERNEL:56': 6,
  'GDI:310': 14,
};

(existsSync(SYSTEM) ? describe : describe.skip)('argument sizes', () => {
  for (const [module, file] of MODULES) {
    it(`${module.name} takes what ${file} takes`, () => {
      const sizes: Record<string, number | null> = JSON.parse(
        execFileSync('node', [SCRIPT, file, '--json'], { cwd: ROOT, encoding: 'utf8' })
      );
      const exports = module.exports;
      const wrong: string[] = [];

      for (const [ordinal, read] of Object.entries(sizes)) {
        const size = EXCEPTIONS[`${module.name}:${ordinal}`] ?? read;

        if (size === null) {
          continue;
        }

        const entry = exports[Number(ordinal)];
        const declared = entry?.[2] ?? 0;

        if (declared !== size) {
          wrong.push(`${ordinal} ${entry?.[1] ?? '(none)'}: ${declared}, Windows ${size}`);
        }
      }

      expect(wrong).toEqual([]);
    }, 120000);
  }
});
