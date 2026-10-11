'use strict';

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Executable } from '../../src/executable.js';
import { LoadCursor } from '../../src/win16/user/cursor-api.js';
import { IMAGE, MemoryFile, runProbe, screenAsShown } from './run-probe.js';

/**
 * A second sweep of Windows 3.1's own programs, used as a person at the
 * page uses them -- Terminal, Control Panel's applets, Recorder, Clipboard
 * Viewer, PIF Editor, Character Map, Sound Recorder, Calendar, Clock -- and
 * held to what shows and what they wrote. The Rust engine's
 * `crates/winbox-web/tests/sweep_terminal_control.rs` does the same and
 * more. Each program runs from `C:\CORPUS\SWEEP`, where what it saves goes.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');

/** A step: keys and clicks, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** Letters, digits and Return typed, as keysyms. */
const typed = (text: string) =>
  [...text].map((c) => (c === '\n' ? 'Return' : c === '.' ? '.' : c)).join(';');

/** A program of the installation run, the steps taken: its trees after each, and a file it wrote. */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  read?: string,
  also: string[] = []
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-sweep-'));

  try {
    for (const file of [program, ...also]) {
      copyFileSync(join(WINDOWS, file), join(copied, file));
    }

    const ran: any = await runProbe('sweep', 0, false, true, 3, {
      program: { directory: copied, file: program, folder: 'SWEEP' },
      virtual: true,
      keepCalls: 0,
      steps,
      trees: true,
    });
    let file: Buffer | null = null;

    if (read) {
      const opened = await ran.fileSystem.open(['CORPUS', 'SWEEP', read]);

      file = opened ? Buffer.from(await opened.read(0, opened.info.size)) : null;
    }

    const windows = async (name: string) => {
      const opened = await ran.fileSystem.open(['WINDOWS', name]);

      return opened ? Buffer.from(await opened.read(0, opened.info.size)).toString('latin1') : null;
    };

    return { trees: ran.trees.slice(1), file, windows };
  } finally {
    rmSync(copied, { recursive: true, force: true });
  }
}

/** The colour the screen shows at a point, `0xRRGGBB`. */
function colourAt(win16: any, x: number, y: number) {
  const { width, rgb } = screenAsShown(win16);
  const at = (y * width + x) * 3;

  return (rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2];
}

/** A value of an INI file's text. */
function iniValue(text: string | null, section: string, name: string) {
  let inside = false;

  for (const line of (text ?? '').split(/\r?\n/)) {
    const header = /^\[(.*)\]$/.exec(line.trim());

    if (header) {
      inside = header[1].toLowerCase() === section.toLowerCase();
    } else if (inside && line.split('=')[0].trim().toLowerCase() === name.toLowerCase()) {
      return line.slice(line.indexOf('=') + 1).trim();
    }
  }

  return undefined;
}

/** A program of the installation started beside those running, as the page starts one. */
function launch(win16: any, name: string) {
  void (async () => {
    const bytes = new Uint8Array(readFileSync(join(WINDOWS, name)));
    const executable: any = new Executable(
      name.replace(/\.EXE$/, ''),
      `C:\\WINDOWS\\${name}`,
      new MemoryFile(bytes)
    );

    await executable.parse();

    const handle = await win16.load(executable);

    win16.link(handle);
    win16.run(handle, { directory: 'C:\\WINDOWS' });
  })();
}

/** The control with an identifier in the window shown with a title. */
function controlOf(win16: any, title: string, id: number) {
  const windows = win16.rasterDesktop.windows;
  const parent = windows.find((w: any) => w.visible && w.title === title);

  return windows.find((w: any) => parent && w.parent === parent && w.controlId === id);
}

/** The titles of the windows shown. */
const titles = (win16: any): string[] =>
  win16.rasterDesktop.windows.filter((w: any) => w.visible && !w.parent).map((w: any) => w.title);

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'TERMINAL.EXE')) ? describe : describe.skip)(
  "Windows' accessories, swept again",
  () => {
    it('saves Terminal settings under the name typed', async () => {
      let seen: string[] = [];

      await session('TERMINAL.EXE', [
        step('click:260,210;click:371,182', 2),
        step('Alt_L+f;a', 2),
        step(typed('TEST.TRM\n'), 3, (win16) => {
          seen = titles(win16);
        }),
      ]);

      expect(seen).toContain('Terminal - TEST.TRM');
    }, 300000);

    /* Terminal polls its port with `PeekMessage` and never waits: finding
     * nothing, `PeekMessage` lets the other tasks run, and Notepad started
     * beside it shows its window. */
    it('runs a program started beside Terminal', async () => {
      let seen: string[] = [];

      await session('TERMINAL.EXE', [
        step('click:260,210;click:371,182', 2, (win16) => launch(win16, 'NOTEPAD.EXE')),
        step('Shift_L', 3, (win16) => {
          seen = titles(win16);
        }),
      ]);

      expect(seen).toContain('Notepad - (Untitled)');
    }, 300000);

    /* Control Panel's Color draws its sample and, opened out, its colours'
     * boxes over statics of `SS_USERITEM`, which draw nothing (seg25 `2149`);
     * made wider, the box is due where its children are. Its sample and its
     * boxes take clicks, statics answering `HTTRANSPARENT` (seg25 `24f2`), and
     * a press on its sample lets the mouse go with `SetCapture(0)` (seg1
     * `a8d4`, `289e`), after which Define Custom Colors takes a click. */
    it("shows Control Panel's Color, takes its clicks and writes its colours", async () => {
      const colours: number[] = [];
      let selector = false;
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:33,66', 3, (win16) => {
          colours.push(colourAt(win16, 45, 169), colourAt(win16, 45, 223));
        }),
        step('click:132,316', 2, (win16) => {
          colours.push(colourAt(win16, 290, 143), colourAt(win16, 290, 287));
        }),
        step('click:120,169;click:290,143', 2),
        step('click:397,342', 4, (win16) => {
          selector = titles(win16).includes('Custom Color Selector');
        }),
        step('click:43,335;click:138,336', 2),
        step('click:45,343', 3),
      ]);

      expect(colours.map((colour) => colour.toString(16))).toEqual([
        '80',
        '80',
        'ff0000',
        'ffffff',
      ]);
      expect(selector).toBe(true);

      const win = await windows('WIN.INI');
      const control = await windows('CONTROL.INI');

      expect(iniValue(win, 'colors', 'TitleText')).toBe('255 0 0');
      expect(iniValue(control, 'Custom Colors', 'ColorA')).toBe('FF');
    }, 300000);

    /* Control Panel's Fonts asks its list for the font chosen with
     * `LB_GETSELITEMS` (seg35 `039b`, `2008`), which answered nought; VER.DLL
     * asks `IsRomModule`, which answers nought (`KRNL386.EXE` seg2 `1e9b`)
     * and as a stub left AX as it was, and Control Panel faulted. Add Fonts'
     * list is filled as Fonts is told the box is idle, by `WM_ENTERIDLE`
     * (seg25 `085b`), its TrueType fonts named with GDI's `UnicodeToAnsi`
     * (`GDI.EXE` seg1 `56a3`). */
    it("shows the font chosen in Control Panel's Fonts and lists fonts to add", async () => {
      let description = '';
      let size = '';
      let fonts: string[] = [];

      await session('CONTROL.EXE', [
        step('dblclick:91,66', 3),
        step('click:100,143', 2, (win16) => {
          description = controlOf(win16, 'Fonts', 401)?.control?.text ?? '';
          size = controlOf(win16, 'Fonts', 408)?.control?.text ?? '';
        }),
        step('click:397,146', 3),
        step('dblclick:150,321', 6, (win16) => {
          fonts = [...(controlOf(win16, 'Add Fonts', 1280)?.control?.items ?? [])].map(String);
        }),
      ]);

      /* What it says of the font hangs on GDI's `AddFontResource`, a stub in
       * both engines: not held to here. */
      expect(description).not.toBe('');
      expect(size).toBe('The size of the font on the disk is:  23 KB.');
      expect(fonts).toEqual(
        expect.arrayContaining([
          'Arial (TrueType)',
          'Courier New (TrueType)',
          'Courier 10,12,15 (VGA res)',
        ])
      );
    }, 300000);

    /* Control Panel's Ports' Settings: Tab from its baud rate, a drop-down
     * combo box whose edit control has the focus, moves on from the combo box,
     * the dialog's own control the focus is in (seg25 `0f8c`); it went back to
     * the first control, the same combo box. */
    it("goes through Control Panel's Ports settings with Tab and writes them", async () => {
      let focus = 0;
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:149,66', 3),
        step('click:242,130', 2),
        step(typed('2400') + ';Tab', 1, (win16) => {
          focus = win16.rasterDesktop.focus?.controlId ?? 0;
        }),
        step('Up', 1),
        step('Tab;Down;Return', 2),
      ]);

      expect(focus).toBe(801);
      expect(iniValue(await windows('WIN.INI'), 'ports', 'COM1:')).toBe('2400,m,7,1,x');
    }, 300000);

    /* Control Panel's Mouse: the hourglass Control Panel puts up as it opens
     * the applet goes as the mouse moves over the dialog, whose class's cursor
     * is the arrow, as `GetClassInfo` answers for USER's classes (`classinf`)
     * and `DefWindowProc`'s `WM_SETCURSOR` shows (seg1 `590a`). */
    it("shows the arrow over Control Panel's Mouse and writes its settings", async () => {
      let system: any = null;
      let cursor = 0;
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:207,66', 3),
        step('click:250,150', 1, (win16) => {
          system = win16;
          cursor = win16._cursor;
        }),
        step('click:250,196', 1),
        step('click:39,175;click:39,175', 1),
        step('click:332,77', 2),
      ]);

      expect(cursor).toBe(await LoadCursor.call(system, 0, 32512));

      const win = await windows('WIN.INI');

      expect(iniValue(win, 'windows', 'SwapMouseButtons')).toBe('yes');
      expect(Number(iniValue(win, 'windows', 'DoubleClickSpeed'))).toBeGreaterThan(452);
    }, 300000);

    /* Control Panel's Desktop: its wallpaper's combo box lies under the
     * Wallpaper group box, and neither clips its siblings, so the combo box's
     * edit control draws there (`groupbox`, one level up); it drew nothing.
     * Its spin buttons find where they were pressed with `GetMessagePos`,
     * which the dialog's loop notes as it takes each message with USER's own
     * `PeekMessage` (seg25 `07c7`, seg1 `a76c`). */
    it("shows Control Panel's Desktop's wallpaper and spins its spacing", async () => {
      let ink = false;
      const spacing: string[] = [];

      await session('CONTROL.EXE', [
        step('dblclick:265,66', 3, (win16) => {
          for (let x = 80; x < 120; x++) {
            for (let y = 262; y < 278; y++) {
              ink ||= colourAt(win16, x, y) === 0;
            }
          }

          spacing.push(controlOf(win16, 'Desktop', 116)?.control?.text);
        }),
        step('click:307,263', 1, (win16) => {
          spacing.push(controlOf(win16, 'Desktop', 116)?.control?.text);
        }),
      ]);

      expect(ink).toBe(true);
      expect(spacing).toEqual(['75', '76']);
    }, 300000);

    /* Clock double-clicked loses its title, and its menu with
     * `SetWindowWord(GWW_ID, 0)`: a window at the top keeps its menu in the
     * word a child keeps its identifier in (seg2 `0c31`, seg9 `000c`). */
    it("takes Clock's menu away as it loses its title", async () => {
      const menus: boolean[] = [];
      const look = (win16: any) => {
        const clock = win16.rasterDesktop.windows.find(
          (w: any) => w.visible && w.title === 'Clock'
        );

        menus.push(clock?.menu !== undefined);
      };

      await session('CLOCK.EXE', [step('Shift_L', 1, look), step('dblclick:100,120', 2, look)]);

      expect(menus).toEqual([true, false]);
    }, 300000);

    /* Recorder, told to record, minimizes itself with `SW_MINIMIZE`: USER
     * takes the focus from it (seg6 `1bfa`) and activates the window active
     * before (`1d96`; `minact`), and what is typed after goes there. */
    it('leaves the window beneath Recorder active as it records', async () => {
      let text = '';

      await session('NOTEPAD.EXE', [
        step('Shift_L', 2, (win16) => launch(win16, 'RECORDER.EXE')),
        step('Shift_L', 3),
        step('Alt_L+m;c', 2),
        step(typed('Typing\n'), 3),
        step('a', 1),
        step('b', 1),
        step('c', 2, (win16) => {
          text = controlOf(win16, 'Notepad - (Untitled)', 15)?.control?.text ?? '';
        }),
      ]);

      expect(text).toBe('abc');
    }, 300000);
  }
);
