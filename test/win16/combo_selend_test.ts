'use strict';

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context, prepareFonts } from '../oracle/replay.js';
import { captureCombobox } from '../oracle/replay-windows.js';
import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * `CBN_SELENDOK` (9) and `CBN_SELENDCANCEL` (a), told by a combo box made
 * with the instance of a module made for Windows 3.1 as its list is put
 * away, before `CBN_CLOSEUP` (8) (`USER.EXE` seg33 `0b47`-`0b6f`):
 * `CreateWindow` marks the window of a module whose expected version is
 * 3.10 or more (seg8 `0428`-`0432`). OK for a choice -- F4, Alt and Up or
 * Down, a row of the list (`026a`, `02c8`, `0a20`) -- and cancel for the
 * focus lost (`11e7`) or `CB_SHOWDROPDOWN` (`0700`). The Rust engine's
 * `combobox.rs` does the same.
 *
 * Every probe is made for Windows 3.0, and its recording tells neither; the
 * same probe marked 3.10 in its header tells them, and nothing else of its
 * records moves.
 */

/** A probe run whole, its module marked as made for `version`: what it wrote. */
async function run(probe: string, version: number) {
  const directory = mkdtempSync(join(tmpdir(), 'winbox-selend-'));
  const file = `${probe.toUpperCase()}.EXE`;

  try {
    const bytes = new Uint8Array(readFileSync(join(PROBES, file)));
    const view = new DataView(bytes.buffer);

    /* The NE header's expected Windows version, minor first, at 3Eh. */
    view.setUint16(view.getUint32(0x3c, true) + 0x3e, version, true);
    writeFileSync(join(directory, file), bytes);

    const { fileSystem } = await runProbe(probe, 4000, false, true, 30, {
      virtual: true,
      program: { directory, file, folder: probe.toUpperCase() },
    });
    const written = new Map<string, string>();

    for (const line of recordsFrom((await outputOf(fileSystem, probe)) ?? '')) {
      const at = line.indexOf(') = ');

      written.set(line.slice(0, at + 1), line.slice(at + 4));
    }

    return written;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The records of the 3.10 run that differ from the 3.00 run's. */
function moved(old: Map<string, string>, made: Map<string, string>) {
  return [...made]
    .filter(([key, value]) => old.get(key) !== value)
    .map(([key, value]) => `${key} = ${value}`);
}

const present = (probe: string) =>
  existsSync(IMAGE) && existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`));

describe("a combo box's list put away", () => {
  /* `comboesc`'s dialog: F4 pressed with the list down puts it away as a
   * choice. Escape and Enter are the dialog's, and the list stays down: no
   * word of either. The Open box's drives are COMMDLG's, made with its
   * instance, a module made for 3.0: they tell neither. */
  (present('comboesc') ? it : it.skip)(
    'tells CBN_SELENDOK before CBN_CLOSEUP for F4, and nothing for Escape that leaves it down',
    async () => {
      const old = await run('comboesc', 0x300);
      const made = await run('comboesc', 0x30a);

      expect(old.get('after(list,f4,f4)')).toBe('log=65:8,dropped=0/0,sel=1,focus=65,code=81,up=1');
      expect(moved(old, made)).toEqual([
        'after(list,f4,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1',
        'after(list,altdown,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1',
        'after(list,click,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1',
        'after(drop,f4,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1',
        'after(drop,altdown,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1',
        'after(drop,click,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1',
      ]);
      expect(made.get('after(list,f4,escape)')).toBe(
        'log=2:0,dropped=1/0,sel=1,focus=65,code=81,up=1'
      );
    },
    600000
  );

  /* `comboact`: a row of the dropped list pressed and let go, its window
   * active or not. The list's `LBN_SELCHANGE` puts it away: told as its
   * second `WM_LBUTTONUP` comes, the one the combo box sends it. */
  (present('comboact') ? it : it.skip)(
    'tells CBN_SELENDOK before CBN_CLOSEUP for a row pressed',
    async () => {
      const old = await run('comboact', 0x300);
      const made = await run('comboact', 0x30a);

      expect(old.get('log(press)')).toBe('L201 L202 L202 L18 L46:97 H111:8 H111:1');
      expect(moved(old, made)).toEqual([
        'log(press) = L201 L202 H111:9 L202 L18 L46:97 H111:8 H111:1',
        'log(inactive) = L201 Q86 Q6 H46:3 H86 H6 Q8 H7 H8 H111:3 L202 H111:9 L202 L18 L46:97 H111:8 H111:1',
      ]);
    },
    600000
  );

  /* The `combobox` probe's steps (`replay-windows.ts`), its combo boxes
   * made with an instance of a 3.10 module: Down, and a character, on a
   * drop-down list with its list put away choose a row (OK, and no
   * close-up, nothing being down); the focus taken from it, its list down,
   * to another combo box cancels before `CBN_CLOSEUP`, as a click away
   * does, and taken from one with its list put away cancels alone; and
   * `CB_SHOWDROPDOWN` with nought cancels before `CBN_CLOSEUP`. */
  it('tells CBN_SELENDCANCEL before CBN_CLOSEUP for the focus taken away and CB_SHOWDROPDOWN', async () => {
    await prepareFonts('vga');

    const notes = async (version: number) =>
      [...(await captureCombobox(new Context('vga'), version))]
        .filter(([key]) => key.startsWith('notes:'))
        .map(([key, value]) => `${key} = ${value}`);
    const old = await notes(0x300);
    const made = await notes(0x30a);

    expect(old.filter((note) => !made.includes(note))).toEqual([
      'notes:down = 100:1',
      'notes:char = 100:1',
      'notes:settext = 100:8,100:4,101:3',
      'notes:ddropped = 101:4,103:3,103:7',
      'notes:dclosed = 103:8',
    ]);
    expect(made.filter((note) => !old.includes(note))).toEqual([
      'notes:down = 100:9,100:1',
      'notes:char = 100:9,100:1',
      'notes:settext = 100:a,100:8,100:4,101:3',
      'notes:ddropped = 101:a,101:4,103:3,103:7',
      'notes:dclosed = 103:a,103:8',
    ]);
  }, 300000);
});
