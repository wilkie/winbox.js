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

/**
 * A program of the installation run, the steps taken: its trees after each,
 * and a file it wrote. Files of its own, each a name and its bytes, are put
 * in its folder beside it.
 */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  read?: string,
  also: string[] = [],
  made: [string, Uint8Array][] = []
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-sweep-'));

  try {
    for (const file of [program, ...also]) {
      copyFileSync(join(WINDOWS, file), join(copied, file));
    }

    for (const [name, bytes] of made) {
      writeFileSync(join(copied, name), bytes);
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

/** A bitmap file of sixteen colours, 16 by 16, all red. */
function redBitmap() {
  const bytes = new Uint8Array(14 + 40 + 64 + 128);
  const view = new DataView(bytes.buffer);
  const colours = [
    0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080,
    0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
  ];

  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 14 + 40 + 64, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 16, true);
  view.setInt32(22, 16, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 4, true);
  colours.forEach((rgb, at) => {
    bytes.set([rgb & 0xff, (rgb >> 8) & 0xff, rgb >> 16, 0], 54 + at * 4);
  });
  /* Red is the ninth colour: two pixels a byte. */
  bytes.fill(0x99, 14 + 40 + 64);

  return bytes;
}

/** A bitmap file of 24 bits a pixel, 16 by 16, all orange: red 255, green 128. */
function orangeBitmap() {
  const bytes = new Uint8Array(14 + 40 + 16 * 48);
  const view = new DataView(bytes.buffer);

  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 14 + 40, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 16, true);
  view.setInt32(22, 16, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);

  for (let at = 14 + 40; at < bytes.length; at += 3) {
    bytes.set([0, 128, 255], at);
  }

  return bytes;
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

    /* Control Panel's Color lists "Windows Default" first among its schemes,
     * made of the display driver's `OEMBIN` resource 1, found with
     * `FindResource` on `GetModuleHandle("DISPLAY")` (`MAIN.CPL` seg6
     * `2922`-`2a4f`). Another scheme chosen and then it, its colours are
     * `WIN.INI`'s. */
    it("lists Control Panel's Windows Default colour scheme and chooses it", async () => {
      let schemes: string[] = [];
      let focus = 0;
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:33,66', 3, (win16) => {
          const listBox = controlOf(win16, 'Color', 715)?.control?.combo?.listBox;
          const list = win16.rasterDesktop.windows.find((w: any) => w.hwnd === listBox);

          schemes = [...(list?.control?.items ?? [])].map(String);
          focus = win16.rasterDesktop.focus?.controlId ?? 0;
        }),
        step('Down', 1),
        step('Home', 1),
        step('click:45,343', 3),
      ]);

      expect(schemes[0]).toBe(
        'Windows Default=C0C0C0,FFFFFF,FFFFFF,0,FFFFFF,0,800000,FFFFFF,FFFFFF,C0C0C0,' +
          'C0C0C0,0,C0C0C0,C0C0C0,808080,0,C0C0C0,800000,FFFFFF,0,ffffff'
      );
      expect(focus).toBe(715);

      const win = await windows('WIN.INI');

      expect(iniValue(win, 'colors', 'Background')).toBe('192 192 192');
      expect(iniValue(win, 'colors', 'ActiveTitle')).toBe('0 0 128');
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

      /* What it says of the font: it adds it with GDI's `AddFontResource`. */
      expect(description).toBe('This is a screen or plotter font.');
      expect(size).toBe('The size of the font on the disk is:  23 KB.');
      expect(fonts).toEqual(
        expect.arrayContaining([
          'Arial (TrueType)',
          'Courier New (TrueType)',
          'Courier 10,12,15 (VGA res)',
        ])
      );
    }, 300000);

    /* Control Panel's Fonts' Add Fonts installs `DOSAPP.FON` from the system
     * directory as it is there: `AddFontResource`, then `WIN.INI` `[fonts]`,
     * then `WM_FONTCHANGE` to every window (`MAIN.CPL` seg9 `1cc3`, seg4
     * `0283`). Removed, its line goes from `[fonts]` and its fonts from GDI's
     * table (seg9 `0b5b`). */
    it("adds a screen font with Control Panel's Fonts and removes it", async () => {
      const listed = (win16: any) =>
        win16.fonts.listedEntries().some((entry: any) => entry.file === 'DOSAPP.FON');
      const seen: any[] = [];
      const down = (count: number) => Array(count).fill('Down').join(';');
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:91,66', 3, (win16) => seen.push(listed(win16))),
        step('click:397,146', 3),
        step('dblclick:150,321', 6),
        /* The list's first chosen and let go, the caret moved down to MS-DOS
         * CP 437, the fourteenth, and it chosen. */
        step('click:150,137', 1),
        step(`space;${down(13)};space`, 1),
        step('click:493,125', 4, (win16) => {
          seen.push(listed(win16));
          seen.push([...(controlOf(win16, 'Fonts', 400)?.control?.items ?? [])].map(String));
        }),
        step('click:398,118', 2, (win16) => seen.push(titles(win16).includes('Remove Font'))),
        step('Return', 3, (win16) => {
          seen.push(listed(win16));
          seen.push([...(controlOf(win16, 'Fonts', 400)?.control?.items ?? [])].map(String));
        }),
      ]);

      expect(seen[0]).toBe(false);
      expect(seen[1]).toBe(true);
      expect(seen[2]).toContain('MS-DOS CP 437');
      expect(seen[3]).toBe(true);
      expect(seen[4]).toBe(false);
      expect(seen[5]).not.toContain('MS-DOS CP 437');
      expect(iniValue(await windows('WIN.INI'), 'fonts', 'MS-DOS CP 437')).toBeUndefined();
    }, 300000);

    /* Control Panel's Fonts removes a TrueType font -- its line in `[fonts]`,
     * its `.FOT`, its face from GDI's table -- and Add Fonts installs it again
     * from its `.TTF`: `CreateScalableFontResource` writes a `.FOT` in the
     * system directory, which `AddFontResource` adds (`MAIN.CPL` seg9
     * `1c0c`). */
    it("removes a TrueType font with Control Panel's Fonts and adds it again", async () => {
      const listed = (win16: any) =>
        win16.fonts.trueTypeDirectory.some((resource: any) => resource.file === 'WINGDING.TTF');
      const seen: any[] = [];
      const down = (count: number) => Array(count).fill('Down').join(';');
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:91,66', 3),
        step(`click:100,143;space;${down(17)};space`, 2, (win16) => {
          seen.push(controlOf(win16, 'Fonts', 401)?.control?.text ?? '');
        }),
        step('click:398,118', 2),
        step('Return', 3, (win16) => seen.push(listed(win16))),
        step('click:397,146', 3),
        step('dblclick:150,321', 6),
        /* Wingdings (TrueType), the last of twenty-seven. */
        step('click:150,137', 1),
        step(`space;${down(26)};space`, 1),
        step('click:493,125', 4, (win16) => seen.push(listed(win16))),
      ]);

      expect(seen[0]).toBe(
        'This is a scalable TrueType font that can be displayed on the screen and printed on your printer.'
      );
      expect(seen[1]).toBe(false);
      expect(seen[2]).toBe(true);

      const win = await windows('WIN.INI');

      expect(iniValue(win, 'fonts', 'WingDings (TrueType)')).toBe('WINGDING.FOT');
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
      /* And the mouse's speed, which it sets with `SystemParametersInfo`'s
       * `SPI_SETMOUSE`, written by USER (`sysparam`): as it was, USER's own. */
      expect(
        ['MouseThreshold1', 'MouseThreshold2', 'MouseSpeed'].map((name) =>
          iniValue(win, 'windows', name)
        )
      ).toEqual(['2', '0', '1']);
    }, 300000);

    /* Control Panel's Desktop shows the settings `SystemParametersInfo`
     * answers -- the sizing grid's granularity, the border's width, the
     * screen saver's delay in minutes and fast Alt+Tab -- and sets them with
     * it, which writes them to `WIN.INI` (seg41 `0ed6`, `sysparam`). */
    it("shows and writes Control Panel's Desktop's settings", async () => {
      const seen: any[] = [];
      let parameters: any = null;
      const look = (win16: any) =>
        seen.push(
          [113, 954, 961].map((id) => controlOf(win16, 'Desktop', id)?.control?.text),
          controlOf(win16, 'Desktop', 121)?.control?.checked
        );
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:265,66', 3, look),
        step('click:174,332;click:174,355', 1, look),
        step('click:142,151', 1),
        step('click:326,61', 2, (win16) => {
          parameters = win16._parameters;
        }),
      ]);

      expect(seen).toEqual([['0', '3', '2'], 1, ['1', '4', '2'], 1]);

      const win = await windows('WIN.INI');

      expect(iniValue(win, 'Desktop', 'GridGranularity')).toBe('1');
      expect(iniValue(win, 'windows', 'BorderWidth')).toBe('4');
      expect(iniValue(win, 'windows', 'CoolSwitch')).toBe('0');
      expect([parameters.border, parameters.grid]).toEqual([4, 8]);
    }, 300000);

    /* Control Panel's Keyboard shows the delay and the repeat rate
     * `SystemParametersInfo` answers, `WIN.INI`'s, and sets them with it,
     * which writes them there (`sysparam`). */
    it("shows and writes Control Panel's Keyboard's settings", async () => {
      const thumbs: any[] = [];
      const { windows } = await session('CONTROL.EXE', [
        step('dblclick:323,66', 3, (win16) => {
          for (const id of [603, 601]) {
            const { min, max, pos } = controlOf(win16, 'Keyboard', id)?.control?.scroll ?? {};

            thumbs.push([min, max, pos]);
          }
        }),
        step('click:38,109;click:38,163;click:38,163', 1),
        step('click:272,69', 2),
      ]);

      expect(thumbs).toEqual([
        [0, 3, 1],
        [0, 31, 31],
      ]);

      const win = await windows('WIN.INI');

      expect(iniValue(win, 'windows', 'KeyboardDelay')).toBe('3');
      expect(iniValue(win, 'windows', 'KeyboardSpeed')).toBe('29');
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

    /* Clock double-clicked loses its title: its menu taken away with
     * `SetWindowWord(GWW_ID, 0)`, for a window at the top keeps its menu in
     * the word a child keeps its identifier in (seg2 `0c31`, seg9 `000c`), its
     * caption taken out of its style, and its frame drawn again by
     * `SetWindowPos` with `SWP_DRAWFRAME` (`CLOCK.EXE` seg1 `1a8e`): its
     * client area laid out again within its sizing frame alone, and the
     * frame drawn so (`swpframe`). */
    it("takes Clock's menu and caption away as it loses its title", async () => {
      const seen: any[] = [];
      let point = [0, 0];
      const look = (win16: any) => {
        const clock = win16.rasterDesktop.windows.find(
          (w: any) => w.visible && w.title === 'Clock'
        );

        if (!seen.length) {
          point = [clock.left + (clock.width >> 1), clock.top + 10];
        }

        seen.push([
          clock?.menu !== undefined,
          clock?.client.top,
          colourAt(win16, point[0], point[1]),
        ]);
      };

      await session('CLOCK.EXE', [step('Shift_L', 1, look), step('dblclick:100,120', 2, look)]);

      expect(seen[0][0]).toBe(true);
      expect(seen[0][1]).toBeGreaterThan(4);
      /* Its client area under its sizing frame, 4 on the VGA, and no caption
       * drawn where it was. */
      expect(seen[1].slice(0, 2)).toEqual([false, 4]);
      expect(seen[1][2]).not.toBe(seen[0][2]);
    }, 300000);

    /* Control Panel's Desktop: a pattern and a wallpaper chosen, and the
     * desktop drawn with them. Desktop writes `[Desktop]`'s `Pattern` itself
     * and has USER make the pattern from it, `SPI_SETDESKPATTERN` with -1, and
     * sets the wallpaper by name with `SPI_SETDESKWALLPAPER` (`MAIN.CPL` seg18
     * `1a19`, `0e09`). The pattern is the desktop's brush, its ones in
     * `COLOR_WINDOWTEXT` and its noughts in `COLOR_BACKGROUND`, from the
     * screen's corner; the wallpaper centred is drawn once in the middle of
     * the screen, the brush about it (`deskwall`). */
    it('draws the desktop with the pattern and wallpaper Desktop chose', async () => {
      const colours: number[] = [];
      const { windows } = await session(
        'CONTROL.EXE',
        [
          step('dblclick:265,66', 3),
          step('Alt_L+n;b;Alt_L+f;r;e;d;.;b;m;p;Alt_L+c', 1),
          step('click:326,61', 2),
          step('Alt_L+F4', 2, (win16) => {
            for (const [x, y] of [
              [0, 0],
              [1, 0],
              [609, 400],
              [609, 407],
              [320, 240],
              [312, 232],
              [311, 232],
            ]) {
              colours.push(colourAt(win16, x, y));
            }
          }),
        ],
        undefined,
        [],
        [['RED.BMP', redBitmap()]]
      );
      const win = await windows('WIN.INI');

      expect(iniValue(win, 'Desktop', 'Pattern')).toBe('127 65 65 65 65 65 127 0');
      expect(iniValue(win, 'Desktop', 'Wallpaper')?.toLowerCase()).toBe('red.bmp');
      expect(iniValue(win, 'Desktop', 'TileWallpaper')).toBe('0');
      /* Boxes' first row is 127, its last nought; the bitmap 16 by 16 in the
       * middle. */
      expect(colours.slice(0, 4)).toEqual([0xc0c0c0, 0, 0, 0xc0c0c0]);
      expect(colours.slice(4, 6)).toEqual([0xff0000, 0xff0000]);
      expect(colours[6]).not.toBe(0xff0000);
    }, 300000);

    /* Control Panel's Desktop given a wallpaper of 24 bits a pixel: USER
     * loads it as any other (`USER.EXE` seg21 `0131`), and the VGA's driver
     * sets each pixel the nearest of its sixteen colours by its own rule,
     * orange yellow (`deskdeep`). */
    it('draws a wallpaper of 24 bits Desktop chose', async () => {
      const colours: number[] = [];
      const { windows } = await session(
        'CONTROL.EXE',
        [
          step('dblclick:265,66', 3),
          step('Alt_L+f;d;e;e;p;.;b;m;p;Alt_L+c', 1),
          step('click:326,61', 2),
          step('Alt_L+F4', 2, (win16) => {
            for (const [x, y] of [
              [320, 240],
              [312, 232],
              [311, 232],
            ]) {
              colours.push(colourAt(win16, x, y));
            }
          }),
        ],
        undefined,
        [],
        [['DEEP.BMP', orangeBitmap()]]
      );
      const win = await windows('WIN.INI');

      expect(iniValue(win, 'Desktop', 'Wallpaper')?.toLowerCase()).toBe('deep.bmp');
      expect(colours.slice(0, 2)).toEqual([0xffff00, 0xffff00]);
      expect(colours[2]).not.toBe(0xffff00);
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

    /* Recorder records what is typed into Notepad with its journal record
     * hook, and plays it back with its playback hook as its shortcut key is
     * pressed in Notepad: USER hands the record hook each key as it is
     * taken and asks the playback hook for each as Notepad looks for input
     * (`system-queue.md`; `jrnlrec`, `jrnlplay`). Before, the journal hooks
     * were kept and never called, and Recorder recorded nothing. */
    it('records what is typed into Notepad, and plays it back', async () => {
      const texts: string[] = [];
      const text = (win16: any) =>
        texts.push(controlOf(win16, 'Notepad - (Untitled)', 15)?.control?.text ?? '');

      await session('NOTEPAD.EXE', [
        step('Shift_L', 2, (win16) => launch(win16, 'RECORDER.EXE')),
        step('Shift_L', 3),
        step('Alt_L+m;c', 2),
        /* The macro's name, and Control and Q its shortcut. */
        step('T;y;p;i;n;g;Tab;q;Return', 3),
        step(typed('abc'), 2),
        /* Recorder's icon pressed: recording suspended, the macro saved. */
        step('click:39,426', 2),
        step('Return', 2, text),
        step('Control_L+q', 4, text),
      ]);

      expect(texts).toEqual(['abc', 'abcabc']);
    }, 300000);
  }
);
