/**
 * Writes the export tables of the modules winbox.js keeps -- each one's
 * name, file, whether its data is fixed, and by ordinal each export's name
 * and the bytes of arguments it pops -- as the Rust engine's
 * `crates/winbox-win16/src/kept.rs`, so that both engines link a program's
 * calls to the same stubs. The modules are in the order `Win16` keeps them,
 * which is the order their selectors are given out.
 *
 * Run with `npm run rust:modules`.
 */

import { writeFileSync } from 'node:fs';

import { CommDlg } from '../../src/win16/commdlg.js';
import { DEFAULT_DISPLAY_MODE, displayMode } from '../../src/win16/display-modes.js';
import { displayDriverFor } from '../../src/win16/display-driver.js';
import { Gdi } from '../../src/win16/gdi.js';
import { Kernel } from '../../src/win16/kernel.js';
import { Keyboard } from '../../src/win16/keyboard.js';
import { MciSeq, MciWave } from '../../src/win16/mmsystem/mci-drivers.js';
import { MMSystem } from '../../src/win16/mmsystem.js';
import { Shell } from '../../src/win16/shell.js';
import { Sound } from '../../src/win16/sound.js';
import { SystemDriver } from '../../src/win16/system-driver.js';
import { Timer } from '../../src/win16/timer.js';
import { ToolHelp } from '../../src/win16/toolhelp.js';
import { User } from '../../src/win16/user.js';
import { Win87EM } from '../../src/win16/win87em.js';
import { WinG } from '../../src/win16/wing.js';

/** As `Win16`'s constructor keeps them: the module and its data's kind. */
const KEPT: [any, 'fixed' | 'moveable'][] = [
  [Kernel, 'fixed'],
  [Gdi, 'moveable'],
  [User, 'moveable'],
  [MMSystem, 'moveable'],
  [Sound, 'fixed'],
  [Win87EM, 'moveable'],
  [WinG, 'moveable'],
  [CommDlg, 'moveable'],
  [Shell, 'moveable'],
  [Keyboard, 'fixed'],
  [SystemDriver, 'fixed'],
  [displayDriverFor(displayMode(DEFAULT_DISPLAY_MODE)), 'fixed'],
  [ToolHelp, 'moveable'],
  [Timer, 'fixed'],
  [MciWave, 'fixed'],
  [MciSeq, 'fixed'],
];

const quote = (text: string) => JSON.stringify(String(text));

const modules = KEPT.map(([module, data]) => {
  const exports = Array.from(module.exports as any[], (entry) =>
    entry ? `Some(Export { name: ${quote(entry[1])}, pops: ${entry[2] || 0} })` : 'None'
  );

  return `    Kept {
        name: ${quote(module.name)},
        path: ${quote(module.path)},
        fixed: ${data === 'fixed'},
        exports: &[
            ${exports.join(',\n            ')},
        ],
    }`;
});

const source = `//! The modules winbox.js keeps, written by \`scripts/rust/modules.ts\` from
//! the TypeScript engine's export tables: do not edit by hand.

use crate::modules::{Export, Kept};

/// In the order they are kept, which is the order their selectors are given.
pub static KEPT: &[Kept] = &[
${modules.join(',\n')},
];
`;

writeFileSync('crates/winbox-win16/src/kept.rs', source);
console.log(`kept: ${KEPT.length} modules -> crates/winbox-win16/src/kept.rs`);
