/**
 * Writes the export tables of the modules winbox.js keeps -- each one's
 * name, file, whether its data is fixed, and by ordinal each export's name
 * and the bytes of arguments it pops -- as the Rust engine's
 * `crates/winbox-win16/src/kept.rs`, so that both engines link a program's
 * calls to the same stubs. The modules are in the order `Win16` keeps them,
 * which is the order their selectors are given out.
 *
 * And the display modes winbox.js can be, as
 * `crates/winbox-win16/data/displays.json`: each one's size, its driver's
 * capabilities, its system metrics and colours, as the probes recorded them.
 *
 * Run with `npm run rust:modules`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import Types from '../../src/win16/types.js';

import { CommDlg } from '../../src/win16/commdlg/index.js';
import { LzExpand } from '../../src/win16/lzexpand/index.js';
import { Ddeml } from '../../src/win16/ddeml/index.js';
import { Ver } from '../../src/win16/ver/index.js';
import { DEFAULT_DISPLAY_MODE, DISPLAY_MODES, displayMode } from '../../src/win16/display-modes.js';
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
  [Ver, 'moveable'],
  [LzExpand, 'moveable'],
  [Ddeml, 'moveable'],
];

const quote = (text: string) => JSON.stringify(String(text));

/** A kept module as Rust source. */
const kept = ([module, data]: [any, 'fixed' | 'moveable']) => {
  /* Each export's name, the bytes it pops, the bytes it answers in -- 0
   * where it leaves AX and DX -- and whether the TypeScript engine only
   * stubs it, answering nought. */
  const exports = Array.from(module.exports as any[], (entry) =>
    entry
      ? `Some(Export { name: ${quote(entry[1])}, pops: ${entry[2] || 0}, returns: ${
          entry[4] === undefined ? 0 : Types.sizeof(entry[4])
        }, stub: ${entry[0] === module.stub} })`
      : 'None'
  );

  return `    Kept {
        name: ${quote(module.name)},
        path: ${quote(module.path)},
        fixed: ${data === 'fixed'},
        exports: &[
            ${exports.join(',\n            ')},
        ],
    }`;
};

const modules = KEPT.map(kept);

/* The display driver's module for each driver a display mode names, its
 * own export table: \`KEPT\`'s is the default display's. */
const drivers = [
  ...new Map(
    Object.values(DISPLAY_MODES).map((mode: any) => [mode.driverFile, displayDriverFor(mode)])
  ).values(),
].map((module) => kept([module, 'fixed']));

const source = `//! The modules winbox.js keeps, written by \`scripts/rust/modules.ts\` from
//! the TypeScript engine's export tables: do not edit by hand.

use crate::modules::{Export, Kept};

/// In the order they are kept, which is the order their selectors are given.
pub static KEPT: &[Kept] = &[
${modules.join(',\n')},
];

/// \`DISPLAY\` as each display driver is, by its file: each driver's own
/// export table.
pub static DISPLAY_DRIVERS: &[Kept] = &[
${drivers.join(',\n')},
];
`;

writeFileSync('crates/winbox-win16/src/kept.rs', source);
console.log(`kept: ${KEPT.length} modules -> crates/winbox-win16/src/kept.rs`);

mkdirSync('crates/winbox-win16/data', { recursive: true });
writeFileSync(
  'crates/winbox-win16/data/displays.json',
  JSON.stringify(DISPLAY_MODES, null, 1) + '\n'
);
console.log(
  `displays: ${Object.keys(DISPLAY_MODES).length} -> crates/winbox-win16/data/displays.json`
);
