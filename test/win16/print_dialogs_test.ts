'use strict';

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Loader } from '../../src/win16/loader.js';
import { mergeIni, parsePreset } from './ini-preset.js';
import { IMAGE, runProbe } from './run-probe.js';

/**
 * COMMDLG's Print Setup dialog, as Windows' own programs open it: Notepad's
 * and Paintbrush's File menu's Print Setup..., with the printer the
 * `vgaprint` installation has -- an Apple LaserWriter Plus on `LPT1:` with
 * Windows' PostScript driver -- put on the drive and in WIN.INI, as `prdlg`
 * writes it. Each is run with `COMMDLG.DLL` on the drive, where the
 * dialog's code is WinBox's own, and with none, where everything is. The
 * Rust engine's `crates/winbox-web/tests/print_dialogs.rs` does the same.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');
const DRIVER = join(
  __dirname,
  '..',
  '..',
  'oracle',
  'build',
  'drive-c-vgaprint',
  'WINDOWS',
  'SYSTEM',
  'PSCRIPT.DRV'
);
const COMMDLG = [['WINDOWS', 'SYSTEM', 'COMMDLG.DLL']];

/** The printer, as `prdlg.c` writes it into WIN.INI. */
const PRINTER = `[windows]
device=Apple LaserWriter Plus,pscript,LPT1:
[devices]
Apple LaserWriter Plus=pscript,LPT1:
`;

/** A step: keys, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** A control of a dialog as it shows: its class, its text, whether it is checked and enabled, a combo box's items. */
type Shown = { text: string; checked: number; enabled: boolean; items: string[] };

/** The controls of the shown window titled `title`, by their ids; null for none. */
function dialog(win16: any, title: string): Map<number, Shown> | null {
  const windows = win16.rasterDesktop.windows;
  const top = windows.find((w: any) => w.visible && !w.parent && w.title === title);

  if (!top) {
    return null;
  }

  /* A combo box's items are its list's, a window of its own (`comboHwnd`). */
  const itemsOf = (w: any) =>
    String(w.control.className).toUpperCase() === 'COMBOBOX'
      ? [
          ...(windows.find(
            (list: any) =>
              String(list.control?.className).toUpperCase() === 'COMBOLBOX' &&
              list.control.comboHwnd === w.hwnd
          )?.control.items ?? []),
        ]
      : [...w.control.items];

  return new Map(
    windows
      .filter((w: any) => w.parent === top && w.control)
      .map((w: any) => [
        w.controlId,
        {
          text: w.control.text,
          checked: w.control.checked,
          enabled: !(w.style & 0x08000000),
          items: itemsOf(w),
        },
      ])
  );
}

/** A program of the installation run with the printer, the steps taken. */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  without: string[][] = []
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-print-'));

  try {
    copyFileSync(join(WINDOWS, program), join(copied, program));
    writeFileSync(
      join(copied, 'WIN.INI'),
      Buffer.from(
        mergeIni(readFileSync(join(WINDOWS, 'WIN.INI'), 'latin1'), parsePreset(PRINTER)),
        'latin1'
      )
    );

    await runProbe('accessories', 0, false, true, 3, {
      program: { directory: copied, file: program, folder: 'SWEEP' },
      virtual: true,
      keepCalls: 0,
      steps,
      without,
      extras: [
        { parts: ['WINDOWS', 'WIN.INI'], file: join(copied, 'WIN.INI') },
        { parts: ['WINDOWS', 'SYSTEM', 'PSCRIPT.DRV'], file: DRIVER },
      ],
    } as any);
  } finally {
    rmSync(copied, { recursive: true, force: true });
  }
}

/** The sizes the PostScript driver names, as COMMDLG names them. */
const SIZES = [
  'Letter 8 1/2 x 11 in',
  'Letter Small 8 1/2 x 11 in',
  'Legal 8 1/2 x 14 in',
  'A4 210 x 297 mm',
  'A4 Small 210 x 297 mm',
  'B5 182 x 257 mm',
  'Note 8 1/2 x 11 in',
];

/**
 * A program's Print Setup opened from its File menu, Landscape chosen and
 * OK pressed, then opened again: what showed each time, and whether
 * COMMDLG was its file.
 */
async function setupTwice(program: string, without: string[][] = []) {
  let first: Map<number, Shown> | null = null;
  let again: Map<number, Shown> | null = null;
  let file = true;

  await session(
    program,
    [
      step('Shift_L', 3),
      step('Alt_L+f'),
      step('r', 2, (win16) => {
        first = dialog(win16, 'Print Setup');
        file = win16._modules.fromName('COMMDLG') instanceof Loader;
      }),
      step('Alt_L+l'),
      step('Return', 2),
      step('Alt_L+f'),
      step('r', 2, (win16) => (again = dialog(win16, 'Print Setup'))),
      step('Escape', 2),
    ],
    without
  );

  return {
    first: first as Map<number, Shown> | null,
    again: again as Map<number, Shown> | null,
    file,
  };
}

/** What Print Setup showed first, for the default printer on `LPT1:`. */
function expectFirst(shown: Map<number, Shown> | null) {
  expect(shown).not.toBe(null);
  expect(shown!.get(0x440)!.text).toBe('(currently Apple LaserWriter Plus on LPT1:)');
  expect(shown!.get(0x422)!.checked).toBe(1);
  expect(shown!.get(0x423)!.checked).toBe(0);
  expect(shown!.get(0x470)!.items).toEqual(['Apple LaserWriter Plus on LPT1:']);
  expect(shown!.get(0x420)!.checked).toBe(1);
  expect(shown!.get(0x471)!.items).toEqual(SIZES);
  expect(shown!.get(0x472)!.items).toEqual(['Upper Tray', 'Manual Feed']);
}

(existsSync(IMAGE) && existsSync(DRIVER) && existsSync(join(WINDOWS, 'NOTEPAD.EXE'))
  ? describe
  : describe.skip)('Print Setup, as the accessories open it', () => {
  /* Notepad keeps the printer and its DEVMODE Print Setup leaves, and gives
   * them back the next time: Landscape stays checked. */
  it("opens Notepad's Print Setup and keeps its Landscape", async () => {
    const { first, again, file } = await setupTwice('NOTEPAD.EXE');

    expect(file).toBe(true);
    expectFirst(first);
    expect(again!.get(0x421)!.checked).toBe(1);
    expect(again!.get(0x420)!.checked).toBe(0);
  }, 300000);

  it('does the same with no COMMDLG.DLL on the drive', async () => {
    const { first, again, file } = await setupTwice('NOTEPAD.EXE', COMMDLG);

    expect(file).toBe(false);
    expectFirst(first);
    expect(again!.get(0x421)!.checked).toBe(1);
  }, 300000);

  it("opens Paintbrush's Print Setup, with COMMDLG.DLL and without", async () => {
    for (const without of [[], COMMDLG]) {
      const { first, again } = await setupTwice('PBRUSH.EXE', without);

      expectFirst(first);
      expect(again!.get(0x421)!.checked).toBe(1);
    }
  }, 600000);
});
