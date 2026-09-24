'use strict';

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Machine } from '../../src/emulator/machine.js';
import { FontManager } from '../../src/win16/font-manager.js';
import { HandleManager } from '../../src/win16/handle-manager.js';
import { Surface } from '../../src/raster/surface.js';
import { Brush } from '../../src/raster/brush.js';
import { Color } from '../../src/raster/color.js';
import { GetStockObject } from '../../src/win16/gdi/GetStockObject.js';
import { SelectObject } from '../../src/win16/gdi/SelectObject.js';
import { GetTextExtent } from '../../src/win16/gdi/GetTextExtent.js';
import { GetTextFace } from '../../src/win16/gdi/GetTextFace.js';
import { GetTextMetrics } from '../../src/win16/gdi/GetTextMetrics.js';
import { GetCharWidth } from '../../src/win16/gdi/GetCharWidth.js';
import { GetDeviceCaps } from '../../src/win16/gdi/GetDeviceCaps.js';
import { GetSystemMetrics } from '../../src/win16/user/GetSystemMetrics.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { Gdi } from '../../src/win16/gdi.js';
import { User } from '../../src/win16/user.js';
import { GlobalAllocator } from '../../src/win16/global-allocator.js';
import { Allocator } from '../../src/win16/allocator.js';

import { lstrlen } from '../../src/win16/kernel/lstrlen.js';
import { CreateFontIndirect } from '../../src/win16/gdi/CreateFontIndirect.js';
import { GetPrivateProfileInt } from '../../src/win16/kernel/GetPrivateProfileInt.js';
import { GetPrivateProfileString } from '../../src/win16/kernel/GetPrivateProfileString.js';
import { GetProfileString } from '../../src/win16/kernel/GetProfileString.js';
import { WritePrivateProfileString } from '../../src/win16/kernel/WritePrivateProfileString.js';
import { lstrcpy } from '../../src/win16/kernel/lstrcpy.js';
import { lstrcat } from '../../src/win16/kernel/lstrcat.js';
import { lstrcmp } from '../../src/win16/user/lstrcmp.js';
import { lstrcmpi } from '../../src/win16/user/lstrcmpi.js';
import { AnsiUpper } from '../../src/win16/user/AnsiUpper.js';
import { AnsiLower } from '../../src/win16/user/AnsiLower.js';
import { AnsiNext } from '../../src/win16/user/AnsiNext.js';
import { AnsiPrev } from '../../src/win16/user/AnsiPrev.js';
import { GlobalAlloc } from '../../src/win16/kernel/GlobalAlloc.js';
import { GlobalSize } from '../../src/win16/kernel/GlobalSize.js';
import { GlobalFree } from '../../src/win16/kernel/GlobalFree.js';
import { LocalAlloc } from '../../src/win16/kernel/LocalAlloc.js';
import { LocalSize } from '../../src/win16/kernel/LocalSize.js';
import { LocalInit } from '../../src/win16/kernel/LocalInit.js';
import { GlobalLock } from '../../src/win16/kernel/GlobalLock.js';
import { GlobalUnlock } from '../../src/win16/kernel/GlobalUnlock.js';
import { GlobalFlags } from '../../src/win16/kernel/GlobalFlags.js';
import { GlobalHandle } from '../../src/win16/kernel/GlobalHandle.js';
import { GlobalReAlloc } from '../../src/win16/kernel/GlobalReAlloc.js';

/**
 * Replaying the oracle's recordings against our implementation.
 *
 * `scripts/oracle/record.mjs` runs a probe under real Windows 3.1 and writes
 * down every call it made and what came back. This runs the same calls against
 * us and compares, which turns "is our API right" into a number the same way
 * the CPU conformance oracle did for instructions.
 *
 * What this does not do is run the probe's own binary. That would be the
 * stronger check -- it would put the loader, the linker and the thunks under
 * test too -- but it needs a Win16 system far enough up to schedule a task,
 * and it needs `_lcreat` and `_lwrite`, which are still stubs, or the probe
 * has nowhere to write its answers. So for now the arguments are marshalled
 * the way the thunk layer marshals them and the implementation is called
 * directly. Everything the fixtures actually describe -- what the functions
 * return, given what they were passed -- is still being measured.
 */

export const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');

/** The drive the oracle builds, which is where the fonts are. */
export const DRIVE_IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/**
 * The fonts, loaded once.
 *
 * GDI cannot be asked anything about text without them, and they live on the
 * drive image rather than in the repository, so this is both slow and
 * conditional. Loading it once and sharing it keeps the replay honest --
 * every adapter sees the same fonts a running system would.
 */
let fonts: any = null;

/** One manager per display, because each installs its own raster fonts. */
const byDisplay: Record<string, any> = {};

/**
 * `WIN.INI` as the installer left it.
 *
 * `GetProfileString` reads this file and nothing else, so the recorded answers
 * are answers about the installed system. Read off the same drive image as the
 * fonts, in the same step, because it is the same asynchronous mount.
 */
let windowsProfile: string | null = null;

/**
 * The file the profile probe writes for itself before it reads anything.
 *
 * This has to match `writeSubject` in `oracle/probes/profile.c` byte for byte:
 * the probe recorded Windows reading *that* text, and replaying against any
 * other text would compare two different questions. It is duplicated rather
 * than shared because one side is C compiled for Win16 and the other is not.
 */
const SUBJECT_PROFILE = [
  '[Plain]',
  'entry=value',
  'spaced   =   padded value   ',
  'quoted="  kept  "',
  "single='  also  '",
  'empty=',
  'MiXeD=case test',
  'number=42',
  'trailing=40two',
  'negative=-1',
  'words=none',
  'quotednumber="7"',
  '; a comment line',
  'semicolon=;',
  'equals=a=b',
  '',
  '[Second]',
  'only=one',
  '',
].join('\r\n');

/** Loads the installed fonts off the drive image, if it has been built. */
/**
 * Installs the fonts a Windows directory lists, in the order it lists them.
 *
 * Takes anything that can open a path, so the same code serves the FAT image
 * the VGA recording was made from and the host directory another display's
 * installation was left in.
 */
async function install(fileSystem: { open: (path: string[]) => Promise<any> }) {
  const manager: any = new FontManager();

  /* Installed in the order Windows installs them, because the mapper's ties
   * go to the first face in the font directory.
   *
   * GDI's directory is not the `SYSTEM` directory. It is the three boot fonts
   * named in `SYSTEM.INI`, which GDI loads first, and then every line of
   * `WIN.INI` `[fonts]` in the order written, which `USER` adds at start-up.
   * A `.FOT` entry there is a stub that names the `.TTF` it stands for. The
   * installer wrote `[fonts]` with the TrueType faces first and Arial at the
   * top, and that is why a request no strike can answer falls to Arial rather
   * than to Times New Roman, whose file the directory happens to list first.
   */
  const readText = async (path: string[]) => {
    const file = await fileSystem.open(path);
    if (!file) {
      return null;
    }
    const text = new Uint8Array(await file.read(0, file.size));
    return Array.from(text, (byte) => String.fromCharCode(byte)).join('');
  };
  const section = (text: string | null, name: string) => {
    const match = new RegExp(
      `^\\[${name}\\][ \\t]*\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\r\\n]))`,
      'mi'
    ).exec(text ?? '');
    return (match?.[1] ?? '')
      .split(/\r?\n/)
      .map((line) => line.split('=').map((part) => part.trim()))
      .filter((parts) => parts.length === 2 && parts[1]);
  };
  windowsProfile = await readText(['WINDOWS', 'WIN.INI']);
  const systemProfile = await readText(['WINDOWS', 'SYSTEM.INI']);
  const boot = section(systemProfile, 'boot').filter(([key]) =>
    ['fonts.fon', 'fixedfon.fon', 'oemfonts.fon'].includes(key.toLowerCase())
  );
  const installed: string[] = [];
  for (const [, value] of [...boot, ...section(windowsProfile, 'fonts')]) {
    let name = value.split(/[\\/]/).pop()!.toUpperCase();
    if (name.endsWith('.FOT')) {
      /* The stub itself goes to the manager too: its `FONTDIR` entry is where
       * the face's pitch and family come from. See `font-resource.ts`. */
      const stubFile = await fileSystem.open(['WINDOWS', 'SYSTEM', name]);
      if (stubFile) {
        await manager.load(stubFile);
      }
      const stub = await readText(['WINDOWS', 'SYSTEM', name]);
      name =
        /[A-Z0-9_]+\.TTF/i.exec(stub ?? '')?.[0].toUpperCase() ?? name.replace(/\.FOT$/, '.TTF');
    }
    if (installed.includes(name)) {
      continue;
    }
    installed.push(name);
    const file = await fileSystem.open(['WINDOWS', 'SYSTEM', name]);
    if (file) {
      await manager.load(file);
    }
  }
  return manager;
}

export async function prepareFonts(display = 'vga') {
  if (byDisplay[display]) {
    return byDisplay[display];
  }

  /* Every display but the VGA installs its own raster fonts -- an EGA gets
   * `COURB.FON` and `SSERIFB.FON` where a VGA gets the `E` variants -- so
   * replaying an EGA recording against the VGA's strikes compares two
   * different questions. The image only holds one installation, and the
   * directories the installer leaves behind hold the rest, so a display other
   * than the VGA is read from `oracle/build/drive-c-<display>` on the host.
   */
  if (display !== 'vga') {
    const root = join(__dirname, '..', '..', 'oracle', 'build', `drive-c-${display}`);

    if (!existsSync(root)) {
      return null;
    }

    byDisplay[display] = await install({
      open: async (path: string[]) => {
        const at = join(root, ...path);

        if (!existsSync(at)) {
          return null;
        }

        const bytes = Uint8Array.from(readFileSync(at));

        /* Plain arithmetic rather than a `DataView`: the buffer a Node read
         * hands back belongs to another realm than the one the tests run in,
         * and a view of it is refused. */
        const at16 = (offset: number, little: boolean) =>
          little
            ? bytes[offset] | (bytes[offset + 1] << 8)
            : (bytes[offset] << 8) | bytes[offset + 1];

        return {
          name: path[path.length - 1],
          size: bytes.byteLength,
          /* An `ArrayBuffer`, which is what a stream read returns and what the
           * executable reader builds a view over. */
          read: async (offset: number, length: number) =>
            Uint8Array.from(bytes.subarray(offset, Math.min(offset + length, bytes.length))).buffer,
          read8: async (offset: number) => bytes[offset],
          read16: async (offset: number, littleEndian = true) => at16(offset, littleEndian),
          read32: async (offset: number, littleEndian = true) =>
            (littleEndian
              ? at16(offset, true) | (at16(offset + 2, true) << 16)
              : (at16(offset, false) << 16) | at16(offset + 2, false)) >>> 0,
        };
      },
    });

    return byDisplay[display];
  }

  if (fonts) {
    return fonts;
  }

  if (!existsSync(DRIVE_IMAGE)) {
    return null;
  }

  const bytes = new Uint8Array(readFileSync(DRIVE_IMAGE));
  const disk = new Disk(bytes.byteLength, 512, 32768);

  disk.load(bytes);

  const fileSystem: any = new FAT16(disk);
  await fileSystem.mount();

  byDisplay.vga = await install(fileSystem);
  fonts = byDisplay.vga;

  return fonts;
}

/**
 * The string `oracle/probes/font.c` measures every mapped font with.
 *
 * Has to match the probe's `SPECIMEN` exactly: the recorded widths are widths
 * of this text, and measuring anything else compares two different questions.
 */
const FONT_SPECIMEN = 'Wg jpq 128';

/** What `tiepick` measures the extent of. */
const TIE_SPECIMEN = 'Windows';

/** What `rotate` draws and measures at every angle. */
const ROTATE_SPECIMEN = 'AB';

/** A canvas's ink as `rotstyle` writes it: the box, then its rows in hex. */
function inkRows(hex: string, size: number) {
  const bytes = Buffer.from(hex, 'hex');
  const stride = size / 8;
  const ink = (column: number, row: number) => !(bytes[row * stride + (column >> 3)] & (0x80 >> (column & 7)));
  let left = size;
  let top = size;
  let right = -1;
  let bottom = -1;

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (ink(column, row)) {
        left = Math.min(left, column);
        right = Math.max(right, column);
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
      }
    }
  }

  const rows: string[] = [];

  for (let row = top; right >= 0 && row <= bottom; row++) {
    let text = '';

    for (let column = left; column <= right; column += 4) {
      let nibble = 0;

      for (let bit = 0; bit < 4; bit++) {
        nibble = (nibble << 1) | (column + bit <= right && ink(column + bit, row) ? 1 : 0);
      }

      text += nibble.toString(16);
    }

    rows.push(text);
  }

  return `box=${left}:${top}:${right}:${bottom},rows=${rows.join('/')}`;
}

/**
 * The ink box of a cell `drawTurned` read back, in the shape `rotate` writes
 * it: the extent of the clear bits, and how many there are.
 */
function turnedBox(hex: string) {
  const bytes = Buffer.from(hex, 'hex');
  let left = 64;
  let top = 64;
  let right = -1;
  let bottom = -1;
  let ink = 0;

  for (let row = 0; row < 64; row++) {
    for (let column = 0; column < 64; column++) {
      if (bytes[row * 8 + (column >> 3)] & (0x80 >> (column & 7))) {
        continue;
      }

      ink++;
      left = Math.min(left, column);
      right = Math.max(right, column);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }

  return `box=${left}:${top}:${right}:${bottom},ink=${ink}`;
}

/** Thrown by an adapter that cannot run without the drive image. */
export class NeedsDrive extends Error {}

/** Where in guest memory the harness builds its arguments. */
const SCRATCH_SEGMENT = 0x4000;

export type Outcome = 'agreed' | 'disagreed' | 'unimplemented' | 'unsupported';

export interface Replayed {
  function: string;
  args: string;
  expected: string;
  actual: string | null;
  outcome: Outcome;
}

export interface Fixture {
  probe: string;
  /** The display driver it was recorded against, for probes that depend on one. */
  display?: string;
  source: { windows: string };
  records: { function: string; args: string; result: string; section?: string }[];
}

/**
 * A place to build arguments and a `this` for the implementations.
 *
 * The functions that take pointers reach memory through `this.machine`, which
 * is the same road the real thunk layer sends them down.
 */
export class Context {
  machine: any;
  allocator: any;
  globalAllocator: any;
  handles: any;
  fonts: any;
  display: any;
  private next: number;
  private _dos: any = null;

  constructor(display = 'vga') {
    this.machine = new Machine();
    this.next = 0x100;

    /* Which driver we are answering as. A capability fixture is meaningless
     * without it, so the fixture names its display and the context adopts it.
     */
    this.display = displayMode(display);

    /* The memory functions reach their heaps through `this.allocator`, built
     * here the way `Win16` builds it so that the allocator under test is the
     * one the system would really be using.
     */
    this.globalAllocator = new GlobalAllocator(this.machine.cpu, this.machine.memory);
    this.allocator = new Allocator(this.machine.memory, this.globalAllocator);

    this.handles = new HandleManager();
    /* The display's own installation, because the raster fonts differ between
     * them. See `prepareFonts`. */
    this.fonts = byDisplay[display] ?? fonts;
  }

  /**
   * A device context with a stock font selected into it.
   *
   * The canvas behind it is a stub. Measuring a bitmap font is arithmetic over
   * the glyph table and never rasterises anything, but a `Surface` sets a
   * brush and a pen as it is built and those reach for a drawing context, so
   * there has to be something there to reach.
   */
  withStockFont(stock: number) {
    if (!this.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const hdc = this.handles.allocate(new Surface({ getContext: () => ({}) }));
    const font = GetStockObject.call(this, stock);

    if (!font) {
      throw new Error(`no stock font ${stock}`);
    }

    SelectObject.call(this, hdc, font);

    return hdc;
  }

  /**
   * Gives the current data segment a local heap.
   *
   * `LocalAlloc` allocates from the heap belonging to whatever DS holds, and
   * that heap is built by `LocalInit` -- which a task's startup code calls
   * before the program's own entry point runs.
   */
  withLocalHeap(size = 0x2000) {
    const segment = this.machine.cpu.core.ds >> 3;

    if (!this.allocator.heapOf(segment)) {
      LocalInit.call(this, segment, 16, size);
    }

    return this;
  }

  /**
   * Just enough of a file system for the profile calls.
   *
   * They open a file by name, read all of it, and sometimes write it back.
   * Nothing here needs FAT16 or a disk: what is being measured is how the INI
   * text is interpreted, and putting a real file system under it would only
   * add a way for the test to fail for an unrelated reason.
   *
   * Names are matched on the last path component without regard to case,
   * because the probe names its own file with a full path and `WIN.INI`
   * without one.
   */
  get dos() {
    if (this._dos) {
      return this._dos;
    }

    const contents = new Map<string, string>([
      ['probe.ini', SUBJECT_PROFILE],
      ['win.ini', windowsProfile ?? ''],
    ]);

    const open = new Map<number, any>();
    let nextHandle = 1;

    const fileFor = (key: string) => ({
      get size() {
        return contents.get(key)!.length;
      },
      read(offset: number, length: number) {
        const text = contents.get(key)!.substring(offset, offset + length);

        return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
      },
      write(offset: number, bytes: Uint8Array) {
        const before = contents.get(key)!.substring(0, offset);
        const written = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

        contents.set(key, before + written);

        return bytes.length;
      },
      setSize(size: number) {
        contents.set(key, contents.get(key)!.substring(0, size));
      },
    });

    this._dos = {
      files: {
        open(path: string) {
          const key = String(path).split(/[\\/]/).pop()!.toLowerCase();

          if (!contents.has(key)) {
            /* A program is allowed to read settings it has never written, so a
             * file that is not there is opened as an empty one rather than
             * refused -- which is what a real drive does the moment anything
             * writes to it.
             */
            contents.set(key, '');
          }

          const handle = nextHandle++;
          open.set(handle, fileFor(key));

          return handle;
        },
        resolve(handle: number) {
          return open.get(handle);
        },
        close(handle: number) {
          open.delete(handle);
        },
      },
    };

    return this._dos;
  }

  /**
   * Maps a recorded font request and selects the result into a context.
   *
   * The probe wrote a whole `LOGFONT` out flat -- `"MS Sans Serif",h=16,w=0,
   * weight=400,...` -- so this reads it back into one and puts it through the
   * same `CreateFontIndirect` a program calls. Five records ask five different
   * questions about one mapping, so they all come through here.
   */
  mappedFont(args: (string | number)[]) {
    if (!this.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, number> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      fields[name] = Number(value);
    }

    const handle = CreateFontIndirect.call(this, {
      lfHeight: fields.h ?? 0,
      lfWidth: fields.w ?? 0,
      lfWeight: fields.weight ?? 0,
      lfItalic: fields.italic ?? 0,
      lfUnderline: fields.under ?? 0,
      lfStrikeOut: fields.strike ?? 0,
      lfCharSet: fields.charset ?? 0,
      lfPitchAndFamily: fields.pitch ?? 0,

      /* The angle, where the probe named one. 8u. */
      lfEscapement: fields.esc ?? 0,
      lfOrientation: fields.ori ?? 0,

      /* The probe writes the quality by name rather than by number, because
       * `proof` is the only one asked for and a 2 in the record would say
       * nothing about which field it was.
       */
      lfQuality: /quality=proof/.test(args.join(',')) ? 2 : 0,
      lfFaceName: String(args[0] ?? ''),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    /* A surface to select it into, because the metrics are a property of a
     * font in a device context rather than of a font on its own.
     */
    const hdc = this.handles.allocate(new Surface({ getContext: () => ({}) }));

    SelectObject.call(this, hdc, handle);

    const metrics: any = {};
    GetTextMetrics.call(this, hdc, metrics);

    const name = this.place('', 64);
    GetTextFace.call(this, hdc, 64, name.far);

    return { hdc, metrics, face: this.fetch(name.far) };
  }

  /**
   * Draws one character the way the glyph probe drew it, and reads it back.
   *
   * The probe drew into a monochrome bitmap and recorded the bits, so this has
   * to produce the same thing: a thirty-two pixel cell, the character at the
   * same origin, and one bit per pixel saying whether it was inked. Anything
   * darker than halfway counts as ink, which is the only judgement being made
   * -- the probe's bitmap had no greys to lose.
   */
  /**
   * A line into the same thirty-two square cell the glyph probe uses.
   *
   * From the middle of the cell to a point given as an offset, which is how
   * the probe asks: nothing about fonts, one pen a pixel wide, and the ink.
   */
  drawLine(dx: number, dy: number, fromX = 16, fromY = 16) {
    const surface: any = Surface.offscreen(32, 32);

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 32, 32);

    surface.context.strokeStyle = 'black';
    surface.context.beginPath();
    surface.context.excludeLast = true;

    /* A line is the driver's to draw, and the drivers do not agree -- and one
     * that leaves the cell is GDI's, on the driver that cannot clip. */
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;

    surface.context.moveTo(fromX, fromY);
    surface.context.lineTo(fromX + dx, fromY + dy);
    surface.context.stroke();

    return this.readCell(surface);
  }

  drawGlyph(font: any, character: string, cell = 32, ground: any = {}) {
    const surface: any = Surface.offscreen(cell, cell);

    surface.font = font;

    /* What the probe told the device context about the ground behind the text.
     * Only `textbk` sets either; everything else leaves a fresh context's
     * white and `OPAQUE`, which is what these default to. */
    if (ground.back) {
      surface.backcolor = new Color(0x00, 0x00, 0x00);
    }

    surface.backMode = ground.opaque === 0 ? 1 : 2;
    surface.textAlign = ground.align ?? 0;
    surface.charExtra = ground.extra ?? 0;

    /* The plotter faces are drawn as lines, and a line is the driver's -- and
     * a line that leaves the cell is GDI's, on the driver that cannot clip. */
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    // White to start with, as `PatBlt(..., WHITENESS)` left it.
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, cell, cell);

    /* The corner unless the record says otherwise: `textalin` draws in the
     * middle of the cell so an alignment has somewhere to move the text to. */
    const at = ground.at ?? null;

    surface.fillText(at ?? 2, at ?? 0, character);

    return this.readCell(surface, cell);
  }

  /**
   * One `ExtTextOut`, or the `TextOut` it is compared against, into a cell
   * sixty-four by forty-eight. 8t.
   *
   * The probe writes every argument of the call into the record, so this only
   * has to hand them on.
   */
  drawExt(font: any, call: any) {
    const surface: any = Surface.offscreen(call.width ?? 64, call.height ?? 48);

    surface.font = font;
    surface.backcolor = call.dark ? new Color(0x00, 0x00, 0x00) : new Color(0xff, 0xff, 0xff);
    surface.backMode = call.mode;
    surface.charExtra = call.extra ?? 0;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, call.width ?? 64, call.height ?? 48);

    const text = call.text ?? 'AB';
    const pen = [8, 4];

    if (call.textout) {
      surface.fillText(pen[0], pen[1], text);
    } else {
      const rect = call.use ? call.rect : null;
      let ink = false;

      if (call.options & 0x0002) {
        if (rect) {
          surface.paintGround(rect);
        }

        ink = true;
      }

      surface.withClip(rect && call.options & 0x0004 && !surface.turnedText ? rect : null, () => {
        surface.extText(pen[0], pen[1], text, call.dx ?? null, ink);
      });
    }

    return this.readCell(surface, call.width ?? 64, call.height ?? 48);
  }

  /**
   * The text `rotate` and `rotangle` draw, into a cell sixty-four square with
   * the pen in the middle of it so a turned baseline has room to leave in any
   * direction. Black on white with the ground transparent, so the ink is all
   * that comes back. 8u.
   */
  /** The font `rotate` and `rotangle` name: a face, a cell and an angle. */
  turnedFont(args: (string | number)[]) {
    if (!this.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, number> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      fields[name] = Number(value);
    }

    const handle = CreateFontIndirect.call(this, {
      lfHeight: fields.h ?? 0,
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfCharSet: 0,
      lfPitchAndFamily: 0,
      lfEscapement: fields.esc ?? 0,
      lfOrientation: fields.ori ?? 0,
      lfFaceName: String(args[0] ?? ''),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    return this.handles.resolve(handle);
  }

  /** One `rotsq` draw: Symbol, an angle, a pen and a string. */
  drawSquare(args: (string | number)[]) {
    if (!this.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, string> = {};

    for (const field of args) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const handle = CreateFontIndirect.call(this, {
      lfHeight: Number(fields.h ?? 0),
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfCharSet: 2,
      lfPitchAndFamily: 0,
      lfEscapement: Number(fields.esc ?? 0),
      lfOrientation: Number(fields.esc ?? 0),
      lfFaceName: 'Symbol',
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    const [penX, penY] = String(fields.pen ?? '32:32').split(':').map(Number);
    const surface: any = Surface.offscreen(64, 64);

    surface.font = this.handles.resolve(handle);
    surface.backcolor = new Color(0xff, 0xff, 0xff);
    surface.backMode = 1;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 64);

    surface.fillText(penX, penY, String(fields.text ?? 'A').replace(/^"|"$/g, ''));

    return this.readCell(surface, 64, 64);
  }

  drawTurned(font: any) {
    const surface: any = Surface.offscreen(64, 64);

    surface.font = font;
    surface.backcolor = new Color(0xff, 0xff, 0xff);
    surface.backMode = 1;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 64);

    surface.fillText(32, 32, ROTATE_SPECIMEN);

    return this.readCell(surface, 64, 64);
  }

  /**
   * A whole path, drawn as a chain of `LineTo` calls, into the same cell.
   *
   * Deliberately *not* a polyline in the sense `Surface.strokeText` means: this
   * is what a caller making one `LineTo` call per segment gets, and the probe's
   * `poly` records exist to say that a stroke glyph's run through the same
   * points is not the same ink. See `BitmapContext.stroke`.
   */
  drawPath(points: number[][]) {
    const surface: any = Surface.offscreen(32, 32);

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 32, 32);

    surface.context.strokeStyle = 'black';
    surface.context.beginPath();
    surface.context.excludeLast = true;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;

    surface.context.moveTo(points[0][0], points[0][1]);

    for (const [x, y] of points.slice(1)) {
      surface.context.lineTo(x, y);
    }

    surface.context.stroke();

    return this.readCell(surface);
  }

  /**
   * A character drawn far taller than a cell, reported as a column profile.
   *
   * The `bands` probe draws two hundred rows into a sixty-four wide bitmap and
   * writes down the leftmost inked column of each row, or `ff` where the row is
   * empty. A bitmap that size will not fit in a record and the question does
   * not need one: a hairline standing upright gives the same column on every
   * row it occupies, so a break shows as one `ff` between two equal values.
   */
  drawTall(font: any, character: string) {
    const surface: any = Surface.offscreen(64, 200);

    surface.font = font;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 200);

    surface.fillText(2, 0, character);

    const pixels = surface.context.pixels;

    let hex = '';

    for (let row = 0; row < 200; row++) {
      let found = 0xff;

      for (let column = 0; column < 64 && found === 0xff; column++) {
        const at = (row * 64 + column) * 4;

        if (pixels[at] < 0x80 && pixels[at + 3] !== 0) {
          found = column;
        }
      }

      hex += found.toString(16).padStart(2, '0');
    }

    return hex;
  }

  /** The cell as the probes write it: one bit a pixel, white set. */
  readCell(surface: any, cell = 32, rows = cell) {
    const pixels = surface.context.pixels;

    let hex = '';

    for (let row = 0; row < rows; row++) {
      for (let group = 0; group < cell / 8; group++) {
        let byte = 0;

        for (let bit = 0; bit < 8; bit++) {
          const at = (row * cell + group * 8 + bit) * 4;

          // A set bit is white, which is what the probe's background was.
          const inked = pixels[at] < 0x80 && pixels[at + 3] !== 0;

          byte |= (inked ? 0 : 1) << (7 - bit);
        }

        hex += byte.toString(16).padStart(2, '0');
      }
    }

    return hex;
  }

  /**
   * Where the implementations send their tracing.
   *
   * This context stands in for a running `Win16`, so it has to offer what the
   * functions reach for. Their logging is gated behind this on the real thing
   * and is simply dropped here.
   */
  debug() {}

  /** Writes a C string into guest memory and returns where it went. */
  place(text: string, reserve = 0) {
    const core = this.machine.cpu.core;
    const offset = this.next;

    for (let index = 0; index < text.length; index++) {
      core.write8(SCRATCH_SEGMENT, offset + index, text.charCodeAt(index) & 0xff);
    }

    core.write8(SCRATCH_SEGMENT, offset + text.length, 0);

    // Leave room for anything the callee is going to append.
    this.next += Math.max(text.length + 1, reserve);

    return { segment: SCRATCH_SEGMENT, offset, far: (SCRATCH_SEGMENT << 16) | offset };
  }

  /** Reads a C string back out of guest memory. */
  fetch(far: number) {
    const core = this.machine.cpu.core;
    const segment = (far >> 16) & 0xffff;
    let offset = far & 0xffff;

    let text = '';

    for (;;) {
      const byte = core.read8(segment, offset++);

      if (!byte) {
        return text;
      }

      text += String.fromCharCode(byte);
    }
  }

  /**
   * Builds the `String` object the thunk layer hands to an `LPCSTR` argument.
   *
   * It carries the segment and offset it came from, and some implementations
   * read those, so a bare JavaScript string would not be the same thing.
   */
  lpcstr(text: string) {
    const at = this.place(text);
    const value: any = new String(text);

    value.segment = at.segment;
    value.offset = at.offset;

    return value;
  }
}

/**
 * Splits a recorded argument list.
 *
 * The probe writes arguments as it would in C -- `"hello"," world"` or
 * `"abc",3` -- so quoted strings come back as strings and everything else as a
 * number. Strings never contain a quote, which keeps this honest and short.
 */
export function parseArgs(args: string): (string | number)[] {
  const parsed: (string | number)[] = [];
  let at = 0;

  while (at < args.length) {
    if (args[at] === ',') {
      at++;
      continue;
    }

    if (args[at] === '"') {
      const end = args.indexOf('"', at + 1);

      if (end === -1) {
        throw new Error(`unterminated string in arguments: ${args}`);
      }

      parsed.push(args.slice(at + 1, end));
      at = end + 1;
    } else {
      let end = args.indexOf(',', at);
      end = end === -1 ? args.length : end;

      const text = args.slice(at, end);

      /* `Number` reads the probe's 0x-prefixed flags as written. Anything that
       * is not a number stays text: probes describe what they are measuring as
       * well as what they passed -- `moveable grow` names a case rather than an
       * argument -- and turning those into NaN loses the distinction between
       * the cases silently.
       */
      const value = Number(text);

      parsed.push(text.trim() !== '' && !Number.isNaN(value) ? value : text);
      at = end;
    }
  }

  return parsed;
}

/** How the probe wrote a string result down. */
function quoted(text: string) {
  return `"${text}"`;
}

/** The allocation flags a probe's description of a block stands for. */
function flagsFor(name: string) {
  if (name === 'fixed') {
    return 0x0000;
  }

  return name === 'discardable' ? 0x0102 : 0x0002;
}

/**
 * The stock font constants, by the name the probe records them under.
 *
 * Spelled out rather than imported so that the harness measures the numbers
 * Windows was asked with, not whatever our own constants happen to say.
 */
const STOCK = {
  OEM_FIXED_FONT: 10,
  ANSI_FIXED_FONT: 11,
  ANSI_VAR_FONT: 12,
  SYSTEM_FONT: 13,
  DEVICE_DEFAULT_FONT: 14,
  SYSTEM_FIXED_FONT: 16,
};

/** Reads the metrics of whatever font is selected into a context. */
function metricsOf(context: any, stock: number) {
  const hdc = context.withStockFont(stock);
  const tm: any = {};

  GetTextMetrics.call(context, hdc, tm);

  return tm;
}

/** The probe records the sign of a comparison, not its magnitude. */
function sign(value: number) {
  return String(value < 0 ? -1 : value > 0 ? 1 : 0);
}

/**
 * How to run each recorded call against us.
 *
 * One entry per function the probes cover. An adapter marshals the recorded
 * arguments, calls the implementation, and formats what came back exactly the
 * way the probe formatted it -- otherwise the comparison would be measuring
 * the formatting.
 *
 * A function with no entry is reported as unsupported rather than quietly
 * skipped, so that adding probe coverage without adding replay coverage cannot
 * look like success.
 */
/**
 * Every character's advance from 32 to 255, for a request the probes describe
 * by face, height and width alone.
 */
function charWidths(context: any, args: (string | number)[]): number[] | string {
  const { hdc } = context.mappedFont([
    ...args,
    'weight=400',
    'italic=0',
    'under=0',
    'strike=0',
    'charset=0',
    'pitch=0',
  ]);

  const buffer = context.place('', 2 * 224 + 2);

  if (!GetCharWidth.call(context, hdc, 32, 255, buffer.far)) {
    return 'failed';
  }

  const core = context.machine.cpu.core;
  const widths: number[] = [];

  for (let index = 0; index < 224; index++) {
    /* Signed, because `GetCharWidth` fills an array of `int` and the probe
     * prints it with `%d`. A stretch small enough takes a glyph's advance below
     * zero -- Arial's `k` at seven pixels per em asked for a width of one is
     * -1 -- and reading the word back unsigned turns that into 65,535. */
    const word = core.read16(buffer.segment, buffer.offset + index * 2);

    widths.push(word >= 0x8000 ? word - 0x10000 : word);
  }

  return widths;
}

const ADAPTERS: Record<
  string,
  (context: Context, args: (string | number)[]) => string | Promise<string>
> = {
  lstrlen(context, [text]) {
    const at = context.place(text as string);
    return String(lstrlen.call(context, at.far));
  },

  lstrcmp(context, [left, right]) {
    return sign(
      lstrcmp.call(context, context.lpcstr(left as string), context.lpcstr(right as string))
    );
  },

  lstrcmpi(context, [left, right]) {
    return sign(
      lstrcmpi.call(context, context.lpcstr(left as string), context.lpcstr(right as string))
    );
  },

  AnsiUpper(context, [text]) {
    const at = context.place(text as string);
    AnsiUpper.call(context, at.far);

    // The probe recorded the buffer, which these convert in place.
    return quoted(context.fetch(at.far));
  },

  AnsiLower(context, [text]) {
    const at = context.place(text as string);
    AnsiLower.call(context, at.far);

    return quoted(context.fetch(at.far));
  },

  AnsiNext(context, [text]) {
    /* The probe recorded how far the pointer moved rather than where it landed,
     * since an address means nothing outside the run that produced it.
     */
    const at = context.place(text as string);
    const next = AnsiNext.call(context, at.far);

    return String((next & 0xffff) - at.offset);
  },

  AnsiPrev(context, [text, from]) {
    const at = context.place(text as string);
    const previous = AnsiPrev.call(context, at.far, at.far + (from as number));

    return String((previous & 0xffff) - at.offset);
  },

  lstrcpy(context, [source]) {
    // The probe recorded what the destination held afterwards.
    const destination = context.place('', 256);
    const from = context.place(source as string);

    lstrcpy.call(context, destination.far, from.far);

    return quoted(context.fetch(destination.far));
  },

  lstrcat(context, [left, right]) {
    /* The probe copied the first string into a buffer and then appended the
     * second, so the recorded result is both of them.
     */
    const destination = context.place('', 256);
    const first = context.place(left as string);
    const second = context.place(right as string);

    lstrcpy.call(context, destination.far, first.far);
    lstrcat.call(context, destination.far, second.far);

    return quoted(context.fetch(destination.far));
  },

  'GlobalAlloc+GlobalSize'(context, [flags, request]) {
    /* Handles are the allocator's business and two runs need not agree on
     * them, so the probe recorded the size that came back rather than what it
     * came back in.
     */
    const handle = GlobalAlloc.call(context, flags as number, request as number);

    if (!handle) {
      return 'failed';
    }

    return String(GlobalSize.call(context, handle));
  },

  'LocalAlloc+LocalSize'(context, [flags, request]) {
    /* A local heap does not exist until something makes one. In a real program
     * the startup code does it before `WinMain` is reached, so the probe never
     * had to; here it has to happen explicitly, or this would be measuring the
     * absence of a heap rather than the allocator.
     */
    context.withLocalHeap();

    const handle = LocalAlloc.call(context, flags as number, request as number);

    if (!handle) {
      return 'failed';
    }

    return String(LocalSize.call(context, handle));
  },

  GlobalLock(context, [flags]) {
    const handle = GlobalAlloc.call(context, flags as number, 128);

    if (!handle) {
      return 'failed';
    }

    const pointer = GlobalLock.call(context, handle);

    if (!pointer) {
      return 'null';
    }

    /* The selector is the allocator's to choose, so the probe recorded only
     * what does not depend on it: that a global block starts at offset zero of
     * its segment, and whether the handle turned out to be that selector.
     */
    const selector = (pointer >> 16) & 0xffff;

    return `offset=${pointer & 0xffff},handle-is-selector=${selector === handle ? 1 : 0}`;
  },

  /**
   * How a handle relates to the selector its pointer carries.
   *
   * Neither value is comparable on its own, so what the probe recorded is the
   * shape of the relationship rather than either number.
   */
  'handle vs selector'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;

    return `equal=${selector === handle ? 1 : 0},difference=${selector - handle}`;
  },

  /** Which table and privilege level the pair name. */
  'table and privilege bits'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;

    return `handle=${handle & 7},selector=${selector & 7}`;
  },

  /** Whether a block keeps its address across an unlock and a relock. */
  stability(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const before = GlobalLock.call(context, handle);
    GlobalUnlock.call(context, handle);

    // Stir the heap the way the probe does, to give a compactor its chance.
    const filler = [];

    for (let index = 0; index < 8; index++) {
      filler.push(GlobalAlloc.call(context, 0x0002, 4096));
    }

    for (let index = 0; index < 8; index += 2) {
      if (filler[index]) {
        GlobalFree.call(context, filler[index]);
      }
    }

    return `moved=${before === GlobalLock.call(context, handle) ? 0 : 1}`;
  },

  'metrics heights'(context, [name]) {
    const tm = metricsOf(context, STOCK[name as string]);

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  'metrics widths'(context, [name]) {
    const tm = metricsOf(context, STOCK[name as string]);

    return (
      `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth},` +
      `weight=${tm.tmWeight},overhang=${tm.tmOverhang}`
    );
  },

  'metrics character set'(context, [name]) {
    const tm = metricsOf(context, STOCK[name as string]);

    return (
      `first=${tm.tmFirstChar},last=${tm.tmLastChar},default=${tm.tmDefaultChar},` +
      `break=${tm.tmBreakChar},pitch=${tm.tmPitchAndFamily},charset=${tm.tmCharSet}`
    );
  },

  'metrics style'(context, [name]) {
    const tm = metricsOf(context, STOCK[name as string]);

    return `italic=${tm.tmItalic},underlined=${tm.tmUnderlined},struckout=${tm.tmStruckOut}`;
  },

  GetTextFace(context, [name]) {
    const hdc = context.withStockFont(STOCK[name as string]);
    const buffer = context.place('', 64);

    GetTextFace.call(context, hdc, 64, buffer.far);

    return `"${context.fetch(buffer.far)}"`;
  },

  GetTextExtent(context, [name, text]) {
    const hdc = context.withStockFont(STOCK[name as string]);
    const extent = GetTextExtent.call(context, hdc, String(text), String(text).length);

    return `width=${extent & 0xffff},height=${(extent >>> 16) & 0xffff}`;
  },

  GetDeviceCaps(context, [name]) {
    const index = Gdi[name as string];

    if (index === undefined) {
      throw new Unimplemented(`no capability constant named ${name}`);
    }

    return String(GetDeviceCaps.call(context, 0, index));
  },

  GetSystemMetrics(context, [name]) {
    const index = User[name as string];

    if (index === undefined) {
      throw new Unimplemented(`no system metric named ${name}`);
    }

    return String(GetSystemMetrics.call(context, index));
  },

  GetCharWidth(context, [name, range]) {
    const [first, last] = String(range).split('-').map(Number);

    const hdc = context.withStockFont(STOCK[name as string]);
    const buffer = context.place('', 2 * (last - first + 1) + 2);

    if (!GetCharWidth.call(context, hdc, first, last, buffer.far)) {
      return 'failed';
    }

    const core = context.machine.cpu.core;
    const widths = [];

    for (let index = 0; index <= last - first; index++) {
      widths.push(core.read16(buffer.segment, buffer.offset + index * 2));
    }

    return widths.join(',');
  },

  GlobalFlags(context, [flags]) {
    const handle = GlobalAlloc.call(context, flags as number, 64);

    if (!handle) {
      return 'failed';
    }

    return `0x${(GlobalFlags.call(context, handle) & 0xffff).toString(16).padStart(4, '0')}`;
  },

  GlobalHandle(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    // The probe passes the selector out of the pointer it locked.
    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;
    const recovered = GlobalHandle.call(context, selector) & 0xffff;

    return `recovered=${recovered === handle ? 1 : 0}`;
  },

  'lock count'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const first = GlobalLock.call(context, handle);
    const second = GlobalLock.call(context, handle);

    return `same=${first === second ? 1 : 0},count=${GlobalFlags.call(context, handle) & 0xff}`;
  },

  GlobalReAlloc(context, [description, sizes]) {
    /* The probe names the block and the change together, as `moveable
     * grow,256->1024`, so the sizes arrive as one field to split.
     */
    const [from, to] = String(sizes).split('->').map(Number);
    const flags = String(description).startsWith('fixed') ? 0x0000 : 0x0002;

    const handle = GlobalAlloc.call(context, flags, from);

    if (!handle) {
      return 'failed';
    }

    const before = GlobalLock.call(context, handle);
    const resized = GlobalReAlloc.call(context, handle, to, flags);

    if (!resized) {
      return 'failed';
    }

    const after = GlobalLock.call(context, resized);

    return (
      `same-handle=${resized === handle ? 1 : 0},` +
      `same-address=${before === after ? 1 : 0},` +
      `size=${GlobalSize.call(context, resized)}`
    );
  },

  GlobalFree(context) {
    const handle = GlobalAlloc.call(context, 0x0002, 256);

    if (!handle) {
      return 'failed to allocate';
    }

    return `returns=${GlobalFree.call(context, handle) ? 'handle' : 'null'}`;
  },

  /*
   * The profile calls.
   *
   * These read a file, so the harness gives the context one; the subject is
   * the same text the probe wrote for itself, and `WIN.INI` is the real one
   * off the drive image.
   */

  async GetPrivateProfileString(context, args) {
    /* Three arguments means the form with no entry named, which enumerates the
     * section instead of reading one value out of it.
     */
    if (args.length === 3) {
      const [section, , size] = args as [string, string, number];
      const buffer = context.place('', Math.max(Number(size), 1) + 2);

      const count = await GetPrivateProfileString.call(
        context,
        context.lpcstr(section),
        null,
        context.lpcstr(''),
        buffer.far,
        Number(size),
        context.lpcstr('PROBE.INI')
      );

      /* The probe wrote the nulls between the names out as bars so they would
       * survive the record format, and showed exactly the returned count of
       * bytes -- so that is what gets rebuilt here.
       */
      let shown = '';

      for (let at = 0; at < count; at++) {
        const byte = context.machine.cpu.core.read8(buffer.segment, buffer.offset + at);

        shown += byte ? String.fromCharCode(byte) : '|';
      }

      return `${count},${quoted(shown)}`;
    }

    const [section, entry, fallback, size] = args as [string, string, string, number];
    const buffer = context.place('', Math.max(Number(size), 1) + 2);

    const count = await GetPrivateProfileString.call(
      context,
      context.lpcstr(section),
      context.lpcstr(entry),
      context.lpcstr(fallback),
      buffer.far,
      Number(size),
      context.lpcstr('PROBE.INI')
    );

    return `${count},${quoted(context.fetch(buffer.far))}`;
  },

  async GetPrivateProfileInt(context, [section, entry, fallback]) {
    const value = await GetPrivateProfileInt.call(
      context,
      context.lpcstr(section as string),
      context.lpcstr(entry as string),
      Number(fallback),
      context.lpcstr('PROBE.INI')
    );

    return String(value);
  },

  async GetProfileString(context, [section, entry, fallback]) {
    const buffer = context.place('', 130);

    const count = await GetProfileString.call(
      context,
      context.lpcstr(section as string),
      context.lpcstr(entry as string),
      context.lpcstr(fallback as string),
      buffer.far,
      128
    );

    return `${count},${quoted(context.fetch(buffer.far))}`;
  },

  async WritePrivateProfileString(context, [section, entry, value]) {
    /* The probe had no way to write a null pointer down, so it recorded the
     * word NULL where one was passed.
     */
    const written = value === 'NULL' ? null : context.lpcstr(value as string);

    const ok = await WritePrivateProfileString.call(
      context,
      context.lpcstr(section as string),
      entry === 'NULL' ? null : context.lpcstr(entry as string),
      written,
      context.lpcstr('PROBE.INI')
    );

    // The probe read the entry back afterwards, which is the part that matters.
    const buffer = context.place('', 130);

    await GetPrivateProfileString.call(
      context,
      context.lpcstr(section as string),
      context.lpcstr(entry === 'NULL' ? 'x' : (entry as string)),
      context.lpcstr('<gone>'),
      buffer.far,
      128,
      context.lpcstr('PROBE.INI')
    );

    return `${ok},${quoted(context.fetch(buffer.far))}`;
  },

  /*
   * Font mapping.
   *
   * The recorded argument is a whole `LOGFONT` written out flat, so it is
   * parsed back into one and put through the same `CreateFontIndirect` a
   * program would call. Each of the five records for a request asks a
   * different question about the same mapping, so they share the setup.
   */

  'CreateFont face'(context, args) {
    return quoted(context.mappedFont(args).face);
  },

  'CreateFont heights'(context, args) {
    const tm = context.mappedFont(args).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  /* `tiepick` names only a face, a cell height, a weight and an italic flag,
   * and asks the same two questions of every cell from eight to three hundred.
   * The internal leading is the cell less the pixel size, so a record of this
   * shape names the size Windows fitted the request at outright.
   */
  'tie heights'(context, args) {
    const tm = context.mappedFont([
      args[0],
      args[1],
      'w=0',
      args[2],
      args[3],
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  'tie extent'(context, args) {
    const { hdc } = context.mappedFont([
      args[0],
      args[1],
      'w=0',
      args[2],
      args[3],
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]);

    const extent = GetTextExtent.call(
      context,
      hdc,
      context.lpcstr(TIE_SPECIMEN),
      TIE_SPECIMEN.length
    );

    return `width=${extent & 0xffff},height=${(extent >> 16) & 0xffff}`;
  },

  /* `rotate` and `rotsize` sweep the escapement. The internal leading is the
   * cell less the pixel size, so these name the size a turned request was
   * fitted at, the same way `tiepick` names an upright one. 8u.
   */
  'rotate face'(context, args) {
    const fields = [args[0], args[1], args[2], args[3], 'w=0', 'weight=400', 'italic=0'];
    const mapped = context.mappedFont([...fields, 'under=0', 'strike=0', 'charset=0', 'pitch=0']);
    const tm = mapped.metrics;
    const extent = GetTextExtent.call(
      context,
      mapped.hdc,
      context.lpcstr(ROTATE_SPECIMEN),
      ROTATE_SPECIMEN.length
    );

    return (
      `face=${quoted(mapped.face)},height=${tm.tmHeight},ascent=${tm.tmAscent},` +
      `descent=${tm.tmDescent},internal=${tm.tmInternalLeading},` +
      `average=${tm.tmAveCharWidth},maximum=${tm.tmMaxCharWidth},` +
      `pitch=${tm.tmPitchAndFamily},extent=${extent & 0xffff}:${(extent >> 16) & 0xffff}`
    );
  },

  'rotate heights'(context, args) {
    const fields = [args[0], args[1], args[2], 'w=0', 'weight=400', 'italic=0'];
    const mapped = context.mappedFont([...fields, 'under=0', 'strike=0', 'charset=0', 'pitch=0']);
    const tm = mapped.metrics;
    const extent = GetTextExtent.call(
      context,
      mapped.hdc,
      context.lpcstr(TIE_SPECIMEN),
      TIE_SPECIMEN.length
    );

    return (
      `face=${quoted(mapped.face)},height=${tm.tmHeight},ascent=${tm.tmAscent},` +
      `descent=${tm.tmDescent},internal=${tm.tmInternalLeading},` +
      `external=${tm.tmExternalLeading},average=${tm.tmAveCharWidth},` +
      `maximum=${tm.tmMaxCharWidth},extent=${extent & 0xffff}:${(extent >> 16) & 0xffff}`
    );
  },

  'angle metrics'(context, args) {
    const fields = [args[0], args[1], args[2], 'w=0', 'weight=400', 'italic=0'];
    const tm = context.mappedFont([
      ...fields,
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},average=${tm.tmAveCharWidth},` +
      `maximum=${tm.tmMaxCharWidth}`
    );
  },

  /* `rotsq` draws the `rot-square` fabrication -- one plain square, no hint
   * program -- at a pen of its own choosing, so the ink box at an angle is the
   * transform with nothing hinted or curved in the way. 8u.
   */
  'square ink'(context, args) {
    return context.drawSquare(args);
  },

  'square box'(context, args) {
    return turnedBox(context.drawSquare(args));
  },

  /* `polyfill` draws `Polygon` with a null pen and a black brush on a canvas
   * a hundred and twenty-eight square. What it measures is GDI's own fill,
   * which `Surface.fillPolygon` is; the API around it -- pens, brushes, the
   * winding rule -- is not asked. 8u.
   */
  'polygon ink'(context, args) {
    const pts = String(args.find((field) => String(field).startsWith('pts=')))
      .slice(4)
      .split(':')
      .map(Number);
    const surface: any = Surface.offscreen(128, 128);

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 128, 128);
    surface.fillPolygon(
      [
        [pts[0], pts[1]],
        [pts[2], pts[3]],
        [pts[4], pts[5]],
        [pts[6], pts[7]],
      ],
      new Color(0, 0, 0)
    );

    return inkRows(context.readCell(surface, 128, 128), 128);
  },

  /* `rotstyle` draws "AB" turned, one variation at a time: the opaque ground,
   * the rules, a smeared and a filed bold, a synthesised slant, the
   * alignments, and `ExtTextOut`'s rectangle. 8u.
   */
  'style ink'(context, args) {
    const what = String(args[0]);
    const fields: Record<string, string> = {};

    for (const field of args.slice(2)) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const face = String(args[1]).replace(/^"|"$/g, '');
    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h),
      lfWidth: 0,
      lfEscapement: Number(fields.esc),
      lfOrientation: Number(fields.esc),
      lfWeight: Number(fields.weight),
      lfItalic: Number(fields.italic),
      lfUnderline: Number(fields.under),
      lfStrikeOut: Number(fields.strike),
      lfCharSet: face === 'Symbol' ? 2 : 0,
      lfPitchAndFamily: 0,
      lfFaceName: face,
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    const opaque = Number(fields.mode) === 2;
    const surface: any = Surface.offscreen(128, 128);

    surface.font = context.handles.resolve(handle);
    surface.backcolor = opaque ? new Color(0, 0, 0) : new Color(0xff, 0xff, 0xff);
    surface.textColor = opaque ? new Color(0xff, 0xff, 0xff) : null;
    surface.backMode = Number(fields.mode);
    surface.textAlign = Number(fields.align);
    surface.context.lineTie = context.display.lineTie;
    surface.context.clipCaps = context.display.clipCaps;
    surface.boldOverhang = context.display.boldOverhang;
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 128, 128);

    if (what === 'ext') {
      const [dl, dt, dr, db] = String(fields.rect).split(':').map(Number);
      const rect = { left: 64 + dl, top: 64 + dt, right: 64 + dr, bottom: 64 + db };
      const options = Number(fields.opt);

      if (options & 0x0002) {
        surface.paintGround(rect);
      }

      surface.withClip(options & 0x0004 && !surface.turnedText ? rect : null, () => {
        surface.extText(64, 64, 'AB', null, (options & 0x0002) !== 0);
      });
    } else {
      surface.fillText(64, 64, 'AB');
    }

    return inkRows(context.readCell(surface, 128, 128), 128);
  },

  /* `rotpen` draws one, two and three squares on a canvas a hundred and sixty
   * square with the pen in the middle, and writes the size, the ascent, the
   * ink box and the box's rows. 8u.
   */
  'pen ink'(context, args) {
    const fields: Record<string, string> = {};

    for (const field of args) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h ?? 0),
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfCharSet: 2,
      lfPitchAndFamily: 0,
      lfEscapement: Number(fields.esc ?? 0),
      lfOrientation: Number(fields.esc ?? 0),
      lfFaceName: 'Symbol',
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    const font = context.handles.resolve(handle);
    const surface: any = Surface.offscreen(160, 160);

    surface.font = font;
    surface.backcolor = new Color(0xff, 0xff, 0xff);
    surface.backMode = 1;
    surface.context.lineTie = context.display.lineTie;
    surface.context.clipCaps = context.display.clipCaps;
    surface.boldOverhang = context.display.boldOverhang;
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 160, 160);
    surface.fillText(80, 80, String(fields.text ?? 'A').replace(/^"|"$/g, ''));

    const bytes = Buffer.from(context.readCell(surface, 160, 160), 'hex');
    const ink = (column: number, row: number) => !(bytes[row * 20 + (column >> 3)] & (0x80 >> (column & 7)));

    let left = 160;
    let top = 160;
    let right = -1;
    let bottom = -1;

    for (let row = 0; row < 160; row++) {
      for (let column = 0; column < 160; column++) {
        if (ink(column, row)) {
          left = Math.min(left, column);
          right = Math.max(right, column);
          top = Math.min(top, row);
          bottom = Math.max(bottom, row);
        }
      }
    }

    const rows: string[] = [];

    for (let row = top; right >= 0 && row <= bottom; row++) {
      let text = '';

      for (let column = left; column <= right; column += 4) {
        let nibble = 0;

        for (let bit = 0; bit < 4; bit++) {
          nibble = (nibble << 1) | (column + bit <= right && ink(column + bit, row) ? 1 : 0);
        }

        text += nibble.toString(16);
      }

      rows.push(text);
    }

    const tm: any = {};
    const hdc = context.handles.allocate(new Surface({ getContext: () => ({}) }));

    SelectObject.call(context, hdc, handle);
    GetTextMetrics.call(context, hdc, tm);

    return (
      `ppem=${tm.tmHeight - tm.tmInternalLeading},ascent=${tm.tmAscent},` +
      `box=${left}:${top}:${right}:${bottom},rows=${rows.join('/')}`
    );
  },

  /* And the pixels of the same draw: the ink box for reading, the bitmap for
   * comparing. 8u.
   */
  'rotate ink'(context, args) {
    return context.drawTurned(context.turnedFont(args));
  },

  'rotate box'(context, args) {
    return turnedBox(context.drawTurned(context.turnedFont(args)));
  },

  'angle box'(context, args) {
    return turnedBox(context.drawTurned(context.turnedFont(args)));
  },

  /* `groundw` asks the three widths that could be the ground's -- what
   * `GetTextExtent` answers for the character, what `GetCharWidth` answers for
   * it, and the overhang -- of the same request. 8o.
   */
  width(context, args) {
    const character = String(args[2]).replace(/^'|'$/g, '');

    const fields = [args[0], args[1], 'w=0', 'weight=400', 'italic=0'];
    const mapped = context.mappedFont([
      ...fields,
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]);
    const tm = mapped.metrics;

    const extent = GetTextExtent.call(
      context,
      mapped.hdc,
      context.lpcstr(character),
      character.length
    );

    const widths = charWidths(context, fields);

    return (
      `extent=${extent & 0xffff},` +
      `charwidth=${typeof widths === 'string' ? -1 : widths[character.charCodeAt(0) - 32]},` +
      `overhang=${tm.tmOverhang},ave=${tm.tmAveCharWidth}`
    );
  },

  /* `clipedge` walks `ETO_CLIPPED`'s edges across the text a column at a time,
   * and asks the degenerate rectangles on purpose. 8t.
   */
  clip(context, args) {
    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, string> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h ?? 0),
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfCharSet: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfFaceName: String(args[0]),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    const rect = String(fields.rect ?? '0:0:0:0')
      .split(':')
      .map(Number);

    return context.drawExt(context.handles.resolve(handle), {
      text: 'AB',
      textout: false,
      options: Number(fields.opt ?? 0),
      use: 1,
      rect: { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] },
      mode: 1,
      dark: 0,
      extra: 0,
      dx: null,
    });
  },

  /* `groundrn` sweeps the ground behind a **run**: four faces, ten cells, five
   * runs, and an advance array, all painted in the background's own colour so
   * that the rectangle is all that comes back. 8o.
   */
  run(context, args) {
    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, string> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h ?? 0),
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfCharSet: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfFaceName: String(args[0]),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    return context.drawExt(context.handles.resolve(handle), {
      width: 96,
      height: 56,
      text: String(fields.s ?? ''),
      textout: !fields.dx,
      options: 0,
      use: 0,
      rect: { left: 0, top: 0, right: 0, bottom: 0 },
      mode: 2,
      dark: 1,
      extra: 0,
      dx: fields.dx ? String(fields.dx).split(':').map(Number) : null,
    });
  },

  /* `extout` draws two characters through `ExtTextOut` at every combination of
   * its rectangle, its flags and its advance array, and through `TextOut` as
   * the control. Every argument is in the record. 8t.
   */
  cell(context, args) {
    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, string> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h ?? 0),
      lfWidth: 0,
      lfWeight: 400,
      lfItalic: 0,
      lfCharSet: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfFaceName: String(args[0]),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    const rect = String(fields.rect ?? '0:0:0:0')
      .split(':')
      .map(Number);

    return context.drawExt(context.handles.resolve(handle), {
      textout: args.slice(1).includes('textout'),
      options: Number(fields.opt ?? 0),
      use: Number(fields.use ?? 0),
      rect: { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] },
      mode: Number(fields.mode ?? 2),
      dark: Number(fields.dark ?? 0),
      extra: Number(fields.extra ?? 0),
      dx: fields.dx ? String(fields.dx).split(':').map(Number) : null,
    });
  },

  /* `groundbx` draws one character in the background's own colour, so the
   * glyph adds nothing and the rectangle is all that comes back. 8o.
   */
  ground(context, args) {
    return ADAPTERS.glyph(context, [
      args[0],
      args[1],
      'back=1',
      'opaque=1',
      'cell=64',
      args[2],
    ]);
  },

  /* `strikout` draws a full stop with the strikeout off and on, over every
   * strike the installation has at eighteen sizes, so the rows the rule adds
   * are the rows the rule is. 8n.
   */
  band(context, args) {
    return ADAPTERS.glyph(context, [args[0], args[1], 'under=0', args[2], 'cell=64', "'.'"]);
  },

  'band metrics'(context, args) {
    const mapped = context.mappedFont([
      args[0],
      args[1],
      'w=0',
      'weight=400',
      'italic=0',
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]);
    const tm = mapped.metrics;

    return (
      `face=${quoted(mapped.face)},height=${tm.tmHeight},ascent=${tm.tmAscent},` +
      `descent=${tm.tmDescent},internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  /* `tiewide` asks the tie region of 8r in the five faces `tiepick` leaves
   * out, on both displays -- which read different groups of the table.
   */
  'wide heights'(context, args) {
    const tm = context.mappedFont([
      args[0],
      args[1],
      'w=0',
      args[2],
      args[3],
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  /* `dipcell` asks the eight cells where `VDMX` dips -- where a size fits a
   * taller cell than the size above it -- and the two either side of each. 8s.
   */
  'dip heights'(context, args) {
    const tm = context.mappedFont([
      args[0],
      args[1],
      'w=0',
      args[2],
      args[3],
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading},external=${tm.tmExternalLeading}`
    );
  },

  /* `symadv` asks Symbol alone, one cell at a time, and records the size it
   * was fitted at, the advance of each character of its specimen, and the
   * extent of the whole string -- so the sum can be checked against its parts.
   */
  'symbol size'(context, args) {
    const tm = context.mappedFont(['Symbol', ...args, 'w=0', 'weight=400', 'italic=0']).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `internal=${tm.tmInternalLeading}`
    );
  },

  'symbol advances'(context, args) {
    const widths = charWidths(context, ['Symbol', ...args, 'w=0']);

    if (typeof widths === 'string') {
      return widths;
    }

    return [...TIE_SPECIMEN]
      .map((character) => `${character}=${widths[character.charCodeAt(0) - 32]}`)
      .join(',');
  },

  'symbol extent'(context, args) {
    const { hdc } = context.mappedFont([
      'Symbol',
      ...args,
      'w=0',
      'weight=400',
      'italic=0',
    ]);

    const extent = GetTextExtent.call(
      context,
      hdc,
      context.lpcstr(TIE_SPECIMEN),
      TIE_SPECIMEN.length
    );

    return `width=${extent & 0xffff},height=${(extent >> 16) & 0xffff}`;
  },

  /* The dense maximum width sweep. The arguments name only a face, a height
   * and a width, so the rest of the request is the probe's own defaults.
   */
  metrics(context, args) {
    const mapped = context.mappedFont([
      ...args,
      'weight=400',
      'italic=0',
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]);
    const tm = mapped.metrics;

    return (
      `face=${quoted(mapped.face)},height=${tm.tmHeight},` +
      `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth}`
    );
  },

  /* The same request measured after different things, to say whether the
   * metrics depend on anything but the request. `after` names what preceded it
   * and is not part of the question.
   */
  ordered(context, args) {
    const tm = context.mappedFont([
      ...args.filter((field) => !String(field).startsWith('after=')),
      'weight=400',
      'italic=0',
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]).metrics;

    return `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth},overhang=${tm.tmOverhang}`;
  },

  /* The widest character `GetCharWidth` reports, and which one it is.
   *
   * `tmMaxCharWidth` is documented as this and is not: the metric is a stored
   * design number scaled, and this is a maximum over rounded advances. The
   * `maxwidth` probe records both so the two can be told apart.
   */
  charwidths(context, args) {
    const widths = charWidths(context, args);

    if (typeof widths === 'string') {
      return widths;
    }

    let widest = 0;
    let at = 0;

    for (let index = 0; index < widths.length; index++) {
      if (widths[index] > widest) {
        widest = widths[index];
        at = index + 32;
      }
    }

    return `widest=${widest},at=${at}`;
  },

  /* Every character's advance, at every width. The probe records the whole
   * array because a proportional face has a couple of hundred different
   * advances and each one is a separate constraint on the horizontal size.
   */
  widths(context, args) {
    const widths = charWidths(context, args);

    return typeof widths === 'string' ? widths : widths.join(',');
  },

  'CreateFont widths'(context, args) {
    const tm = context.mappedFont(args).metrics;

    return (
      `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth},` +
      `weight=${tm.tmWeight},overhang=${tm.tmOverhang}`
    );
  },

  /* Proof quality, which takes the stretched candidates out of the running. */
  'CreateFont quality'(context, args) {
    const tm = context.mappedFont(args).metrics;

    return (
      `height=${tm.tmHeight},ascent=${tm.tmAscent},descent=${tm.tmDescent},` +
      `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth}`
    );
  },

  'CreateFont style'(context, args) {
    const tm = context.mappedFont(args).metrics;

    return (
      `italic=${tm.tmItalic},underlined=${tm.tmUnderlined},struckout=${tm.tmStruckOut},` +
      `pitch=${tm.tmPitchAndFamily},charset=${tm.tmCharSet}`
    );
  },

  'CreateFont extent'(context, args) {
    const { hdc } = context.mappedFont(args);

    /* The thunk layer hands an `LPCSTR` over as a string that remembers where
     * it came from, not as a pointer, so the harness has to build the same
     * thing rather than the address of it.
     */
    const extent = GetTextExtent.call(
      context,
      hdc,
      context.lpcstr(FONT_SPECIMEN),
      FONT_SPECIMEN.length
    );

    return `width=${extent & 0xffff},height=${(extent >> 16) & 0xffff}`;
  },

  /**
   * One character's advance and the size it was drawn at.
   *
   * The `hinting` probe's whole purpose is to be pointed at a fabricated font
   * whose glyph program has been rewritten to report something else through
   * this channel, so the adapter does nothing clever: it asks for the width the
   * same way the probe does and reports the pixel size alongside, because a
   * fabricated reading is meaningless without knowing which size produced it.
   */
  advance(context, args) {
    const { hdc, metrics } = context.mappedFont(args.slice(0, -1));

    // A byte above 127 is named `#xx`, as the `glyph` adapter has it.
    const asked = String(args[args.length - 1] ?? '');
    const character = asked.startsWith('#')
      ? String.fromCharCode(parseInt(asked.slice(1), 16))
      : asked.replace(/^'|'$/g, '');
    const extent = GetTextExtent.call(context, hdc, context.lpcstr(character), character.length);

    return `advance=${extent & 0xffff},ppem=${metrics.tmHeight - metrics.tmInternalLeading}`;
  },

  CreateFontIndirect(context, [face, height]) {
    const { face: resolved, metrics } = context.mappedFont([
      face,
      `h=${String(height).replace(/^h=/, '')}`,
      'w=0',
      'weight=400',
      'italic=0',
      'under=0',
      'strike=0',
      'charset=0',
      'pitch=0',
    ]);

    return (
      `${quoted(resolved)},height=${metrics.tmHeight},` +
      `ave=${metrics.tmAveCharWidth},weight=${metrics.tmWeight}`
    );
  },

  /**
   * What a character actually looks like.
   *
   * The only probe that records pixels, and the only ground truth there is for
   * anything that draws. The stock font cases are the control: they are
   * strikes we already render, so a disagreement there is a disagreement about
   * the comparison rather than about a rasteriser.
   */
  glyph(context, args) {
    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    /* Above ASCII the probe records a character as its code rather than as
     * itself, because the record is text and the character is not.
     */
    const asked = String(args[args.length - 1]);
    const character = asked.startsWith('#')
      ? String.fromCharCode(parseInt(asked.slice(1), 16))
      : asked.replace(/^'|'$/g, '');

    const stock = {
      SYSTEM_FONT: 13,
      ANSI_VAR_FONT: 12,
      ANSI_FIXED_FONT: 11,
    }[String(args[0])];

    let font: any;

    if (stock !== undefined) {
      const handle = GetStockObject.call(context, stock);

      font = context.handles.resolve(handle);
    } else {
      const fields: Record<string, number> = {};

      for (const field of args.slice(1, -1)) {
        const [name, value] = String(field).split('=');

        fields[name] = Number(value);
      }

      const handle = CreateFontIndirect.call(context, {
        lfHeight: fields.h ?? 0,
        lfWidth: fields.w ?? 0,
        lfWeight: fields.weight ?? 0,
        lfItalic: fields.italic ?? 0,

        /* The plotter fonts are only reachable through `OEM_CHARSET`, and the
         * probe says so by writing `oem` among the fields rather than as a
         * number, since it is the only charset any of these records asks for.
         */
        lfCharSet: args.slice(1, -1).includes('oem')
          ? 255
          : args.slice(1, -1).includes('symbol')
            ? 2
            : 0,

        /* The two rules, which only `rules` asks for. */
        lfUnderline: fields.under ?? 0,
        lfStrikeOut: fields.strike ?? 0,
        lfFaceName: String(args[0]),
      });

      if (!handle) {
        throw new Unimplemented('no font mapped');
      }

      font = context.handles.resolve(handle);
    }

    /* The cell is thirty-two pixels square unless the record says otherwise;
     * the sizes probe draws into sixty-four. */
    const cell = Number(
      args
        .slice(1, -1)
        .find((field) => String(field).startsWith('cell='))
        ?.toString()
        .slice(5) ?? 32
    );

    return context.drawGlyph(font, character, cell, {
      back: Number(
        args
          .slice(1, -1)
          .find((field) => String(field).startsWith('back='))
          ?.toString()
          .slice(5) ?? 0
      ),
      extra: Number(
        args
          .slice(1, -1)
          .find((field) => String(field).startsWith('extra='))
          ?.toString()
          .slice(6) ?? 0
      ),
      align: Number(
        args
          .slice(1, -1)
          .find((field) => String(field).startsWith('align='))
          ?.toString()
          .slice(6) ?? 0
      ),
      at: args.slice(1, -1).some((field) => String(field).startsWith('at='))
        ? Number(
            args
              .slice(1, -1)
              .find((field) => String(field).startsWith('at='))
              ?.toString()
              .slice(3)
          )
        : null,
      opaque: args.slice(1, -1).some((field) => String(field).startsWith('opaque='))
        ? Number(
            args
              .slice(1, -1)
              .find((field) => String(field).startsWith('opaque='))
              ?.toString()
              .slice(7)
          )
        : 1,
    });
  },

  /* One line, from the middle of the cell to an offset given as two numbers. */
  line(context, args) {
    return context.drawLine(Number(args[0]), Number(args[1]));
  },

  /* The same from a named point, where a line has room for a longer span and
   * where the point itself can be odd. */
  from(context, args) {
    return context.drawLine(Number(args[2]), Number(args[3]), Number(args[0]), Number(args[1]));
  },

  /* A fan whose long axis is y, which the rings are too short to ask. */
  down(context, args) {
    return context.drawLine(Number(args[3]), Number(args[2]), Number(args[0]), Number(args[1]));
  },

  /**
   * One character drawn two hundred rows tall, as a column profile.
   *
   * The same `CreateFont` fields the glyph probe uses, so the two agree about
   * what was asked for; only the cell and the record's shape differ.
   */
  column(context, args) {
    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    const fields: Record<string, number> = {};

    for (const field of args.slice(1, -1)) {
      const [name, value] = String(field).split('=');

      fields[name] = Number(value);
    }

    const handle = CreateFontIndirect.call(context, {
      lfHeight: fields.h ?? 0,
      lfWidth: fields.w ?? 0,
      lfWeight: fields.weight ?? 0,
      lfItalic: fields.italic ?? 0,

      /* The same marker the `glyph` adapter reads: the plotter faces are only
       * reachable through `OEM_CHARSET`, and the probe writes `oem` among the
       * fields rather than a number. Hard-coding the ANSI charset here maps
       * every one of them to something else, which is 624 records of `plotbig`
       * disagreeing without a single pixel being drawn wrong.
       */
      lfCharSet: args.slice(1, -1).includes('oem')
        ? 255
        : args.slice(1, -1).includes('symbol')
          ? 2
          : 0,
      lfFaceName: String(args[0]),
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    /* The probe quotes the character it drew, so the apostrophe arrives as
     * three quotes in a row. Stripping every quote leaves nothing to draw and
     * the cell comes back blank at every size, which reads as a rasteriser
     * failure and is a parser one; only the outer pair is punctuation.
     */
    return context.drawTall(
      context.handles.resolve(handle),
      String(args[args.length - 1]).replace(/^'|'$/g, '')
    );
  },

  /* A whole polyline, drawn as a chain of `LineTo` calls through named points.
   *
   * The probe holds the runs a plotter glyph computes, so this is the same ink
   * asked for twice: once as a letter and once as the lines the letter is made
   * of. They are not the same, which is the point of having it. */
  /* Two lines end to end, which is the shortest thing that is not one line. */
  chain(context, args) {
    const [x0, y0, x1, y1, x2, y2] = args.map(Number);

    return context.drawPath([
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ]);
  },

  poly(context, args) {
    const points: number[][] = [];

    for (let at = 0; at + 1 < args.length; at += 2) {
      points.push([Number(args[at]), Number(args[at + 1])]);
    }

    return context.drawPath(points);
  },

  /* One line named by both its ends, so a glyph's stroke can be asked for
   * directly rather than rebuilt from a span and an offset. */
  segment(context, args) {
    const [fromX, fromY, toX, toY] = args.map(Number);

    return context.drawLine(toX - fromX, toY - fromY, fromX, fromY);
  },
};

/** Thrown by an adapter for a function we have not implemented at all. */
export class Unimplemented extends Error {}

/**
 * Disagreements we know about and have not fixed.
 *
 * Each of these is a real difference from Windows with a reason it has not
 * simply been corrected, and each is reported as an expected failure -- so the
 * suite stays green while they persist, and turns red the moment one of them
 * starts agreeing and the entry becomes stale.
 */
/**
 * One cell, in a probe that grew to look for it.
 *
 * `glyph` is the one probe that records pixels and the one that could not be
 * satisfied by reading a table. It agreed on ninety-two per cent of the outline
 * glyphs for a long time, and that gap closed in two steps that turned out to
 * be the same step twice: a half rounds upward and not away from zero, once
 * where an outline is scaled and once where it is put into device coordinates.
 *
 * Then the probe was widened to the accented letters, which are composite
 * glyphs -- a quarter of every one of these fonts, and nothing it had asked for
 * before reached any of them. 318 of the first 384 new cells disagreed, and
 * every one of those is now drawn.
 *
 * Widening it again to the punctuation below them found two more letters that
 * had never been drawn either. The middle dot turned out not to be a drawing
 * question at all -- Windows draws a different glyph for that byte than the
 * one Latin-1 asks for, see `TrueTypeFont.ANSI`. The right guillemet was the
 * one glyph in the recorded set that moves its origin phantom, and the outline
 * has to be carried back onto where the pen finished rather than where it
 * started.
 *
 * All 2,574 records agree.
 */
/**
 * Recorded behaviour this implementation is known not to reproduce.
 *
 * Empty, and the aim is to keep it that way: all 40,434 records of the twenty
 * replayed fixtures -- seventeen probes across three displays -- agree with
 * what Windows 3.1 answered. A key here is `probe:function`, or
 * `probe-display:function` for a probe recorded on more than one display, and
 * its value says what is short and by how many records.
 *
 * A gap is a statement about a measurement, not a licence: it belongs here only
 * with a count, and it comes out again the moment the count reaches zero.
 */
/**
 * Recorded behaviour this implementation is known not to reproduce.
 *
 * Empty, and the aim is to keep it that way: every record the harness knows how
 * to replay agrees with what Windows 3.1 answered. A key here is
 * `probe:function`, or `probe-display:function` for a probe recorded on more
 * than one display, and its value says what is short and by how many records.
 *
 * Being empty is not the same as everything being checked. A probe function
 * with no adapter is reported as unimplemented rather than as a disagreement --
 * `stack`'s 3,650 records are carried that way -- so an adapter written is a
 * question asked for the first time, and `charwidths` had 1,782 records waiting
 * on one. A gap belongs here only with a count, and comes out again the moment
 * the count reaches zero.
 */
export const KNOWN_GAPS: Record<string, string> = {
  /* Turned text with a smeared bold or a made-up slant.
   *
   * `rotstyle` draws "AB" turned one variation at a time, 190 records, and 169
   * agree: the ground, both rules at either thickness, the alignments,
   * `ExtTextOut` with either flag, a bold file, and everything upright but the
   * smear. The 21 left are two things, neither guessed at:
   *
   * - **The smear, fifteen.** Upright as well as turned: in "AB" Windows draws
   *   the first glyph's overhang and drops the last one's, in both faces, where
   *   the single-glyph rule of section 3 says otherwise for Courier New's `A`.
   *   The last glyph's smear stops at the pen plus the plain advances in all
   *   three records that show it; three records are not enough to write it.
   * - **The made-up slant, six.** Symbol italic turned at thirty, forty-five
   *   and a hundred and eighty degrees. Not yet looked at.
   */
  'rotstyle:style ink': 'the smear in a string of more than one glyph, and the made-up slant turned',



  /* The styled files at cells of two hundred and seventy-four to two hundred
   * and eighty-two, where the size chosen is one pixel per em out.
   *
   * `stemstyl` sweeps Arial and Times New Roman bold, italic and bold italic
   * over the cells that cross every one of their half-size thresholds. It was
   * 723 of 900 on a VGA and 716 on an EGA, and all of that was the size: above
   * the largest `VDMX` tabulates the answer saturated near the top of the
   * table. Filling those sizes in, and letting the search past an exact fit
   * inside the table, is 867 and 859.
   *
   * What is left is a tie inside the table, at four cells below where the
   * switch happens. Windows takes the **later** of two tabulated sizes that fit
   * the cell exactly -- Times New Roman Bold at a cell of 274 has 242 and 243
   * both tabulated at exactly 274, and Windows draws 243 where this draws 242.
   * That is the opposite of what the small-size corpus says, and the small-size
   * corpus is not negotiable: letting the search past an exact fit costs 272 of
   * `font`'s 11,382 records. Whatever separates the two cases is not read.
   *
   * Every cell above the switch is exact, and so is every one of the eight
   * half-size thresholds, which is what `head.xMax` predicted.
   */

  /* Three cells where the ground painted behind the text is the wrong size.
   *
   * `textbk` is the first probe to set a background colour or a background
   * mode at all -- every other one leaves a fresh context's white and `OPAQUE`,
   * where a white rectangle on a white cell cannot be told from no rectangle.
   * It was 48 of 64; honouring both is 61.
   *
   * The three left are all the same case, an opaque black ground behind an
   * outline face at a small size, and in each the rectangle this paints is
   * smaller than the one Windows paints: Arial at a cell of twelve, 73 pixels
   * against 84, and Courier New at twelve and twenty-four, 60 against 72 and
   * 314 against 360. The width and height come from the string's own extent,
   * which the glyph corpus says is right for the advance, so what is wrong is
   * which extent GDI fills rather than the measuring of it. Not read.
   */

  /* The same tie, asked of the metrics instead of the pixels.
   *
   * `tiepick` sweeps every cell from eight to three hundred in six faces and
   * reports the metrics, and `tmInternalLeading` is the cell less the pixel
   * size -- so each record names the size Windows fitted the request at. 1,717
   * of the 1,758 agree, and where they do not, the pixels `stemstyl` recorded
   * agree with the metrics, so the two probes are short of the same thing.
   *

  /* The glyph sweep on an EGA, 895 cells of 6,046.
   *
   * Recorded for the first time here. Nothing had ever drawn a glyph on a
   * display whose pixel is not square, and the sweep found three separate
   * things; two are fixed and the third is this.
   *
   * The two fixed are both the device aspect going missing where the code
   * assumed a square pixel: the strike chooser's off-square penalty compared
   * against a constant hundred rather than against `MulDiv(100, aspectX,
   * aspectY)`, which cost 294 cells and every raster face; and the vector
   * faces' average width left the device's aspect out of the floor it is
   * settled by, which cost 298 more.
   *
   * A third was found by tracing rather than by counting: `WCVTF` writes a
   * control value given in font units, and it was scaling it at the vertical
   * size where the table's own values are scaled at `cvtSize`, so a value
   * written and read straight back came out through the stretch factors twice.
   * That is 281 more cells and it is the first thing the EGA has said about the
   * interpreter rather than about the mapper.
   *
   * Two more came from the same method rather than from counting. The cell a
   * glyph is laid out in was measured with the *vertical* advance, which made
   * it too narrow to let a bold overhang through; and a synthesised slant is
   * drawn from the raw outline, whose design `x` was being scaled down the page
   * rather than across it. Together 44 more cells and a good deal more than
   * that in pixels -- Symbol's slanted `A` at eight pixels is the right width
   * now and differs only in the two rows at its apex.
   *
   * What is left is 372, and all of it is one thing.
   *
   * What is left is 295, and the synthesised slant is no longer any of it: a
   * lean is a whole number of *horizontal* pixels over one em of rise, and
   * carrying it and the side bearing across at the horizontal size took Symbol
   * from 135 cells to 58. See `Surface.leanOf`.
   *
   * The 237 that remain in Arial, Times New Roman and Courier New are all
   * `italic=1`, and none of them is a synthesis: those three ship an italic
   * file, so what is being drawn is an ordinary hinted outline out of it. The
   * other 58 are Symbol, 45 slanted and 13 upright.
   *
   * Three things are known about the 237 and they narrow it a long way.
   *
   *   - **The program runs.** Drawing those same cells from the raw outline
   *     with no program at all gets 37 of 654 where running it gets 417, so
   *     Windows is hinting them and the fault is inside the run rather than in
   *     whether to make one.
   *   - **The run is right for an upright glyph.** The `widths` sweep is 2,270
   *     glyph cells drawn stretched on a VGA and every one of them agrees, as
   *     does every upright cell of this sweep. But that sweep asks for no
   *     italic at all -- 2,270 cells across four faces, none slanted -- so a
   *     slanted design under a stretch had never been drawn anywhere until this
   *     recording. It is the first corpus that exercises it.
   *   - **It is the glyphs with stems.** `b`, `j`, `m`, `B`, `E`, `K`, `N`,
   *     `R`, `k`, `n`, `1`, `M`, `4`, `d` head the list at fourteen or fifteen
   *     cells each of the eighteen they are asked for, and in an italic file a
   *     stem is a diagonal. Two thirds of the failures are under twelve wrong
   *     pixels in a cell of 1,024, and the shape of them is a stem placed a
   *     column over at one end and right at the other.
   */
  /* The `font` sweep on an EGA is closed, and so is the VGA's.
   *
   * It began at 4,502 the day an EGA was first recorded and both are exact now
   * -- 5,057 of 5,057 each. The commits between say what every step was and
   * `FONTS.md` section 3 has all of them, along with the readings refused with
   * counts on the way.
   */
  /* The `font` sweep on a Hercules is closed too, 11,382 of 11,382.
   *
   * It was recorded because a Hercules reports the *same* two logical
   * resolutions an EGA does, ninety-six across and seventy-two down, and a
   * wholly different pixel -- `ASPECTX` eleven and `ASPECTY` sixteen against
   * thirty-eight and forty-eight -- so it tells apart every aspect rule that
   * two agreeing displays had pinned. Every one of them held.
   *
   * What did not was how far a strike is stretched sideways, and it took the
   * rest of a session: not the driver, which stubs `RealizeObject` for fonts on
   * all three displays; not the penalty routine's `across`, which only prices a
   * candidate; not the vector chain, which is the plotter's. It is `RC_BIGFONT`,
   * bit ten of `RASTERCAPS`, which this display alone does not have -- so its
   * realised font is held to a segment and both multiples come down until it
   * fits. `FONTS.md` section 3 has the arithmetic and the readings refused.
   */



  /* `lines` is closed, on all four displays, 2,478 records each.
   *
   * It began as four rings of offsets round the middle of a thirty-two square
   * cell and grew every time a plotter glyph asked something it could not
   * answer: seven rings, corner fans that buy a span of thirty-one, fans from
   * odd coordinates, fans whose long axis is y, lines that leave the cell
   * altogether, every line of four pixels or fewer from five origins, and whole
   * polylines -- the runs a plotter glyph computes, drawn as chains of `LineTo`
   * calls through the same points.
   *
   * Those last are the instrument that separated two things nothing had been
   * able to tell apart. A stroke glyph's run and a chain of `LineTo` calls
   * through the same points do **not** draw the same ink, so a letter is not
   * drawing what a line would draw. See `BitmapContext.stroke`.
   */

  /* The glyph corpus is closed, on all four displays.
   *
   * `glyphs` is 6,046 records on each of a VGA, a Super VGA, an EGA and a
   * Hercules, and every one of them agrees; so is `plotter`'s 1,584 on each,
   * and `lines`' 2,478. **Every glyph cell Windows has been recorded drawing,
   * in either corpus, is drawn the same way here.**
   *
   * The last two were `Symbol`'s slanted `m` and `y` at fifteen, on the two
   * displays whose pixel is not square, and they were not a rule at all. The
   * stretch was applied to the design coordinate and the scale to the result,
   * two multiplications where Windows has one: `230 * (8/12) * (12/2048) * 64`
   * is exactly 57.5 and came out of the arithmetic as 57.49999999999999, which
   * rounds the wrong way and puts the point a sixty-fourth to the left. One
   * sixty-fourth on one point moved a crossing across a rounding boundary, and
   * through it a dropout, and through that a second rescue the first had
   * blocked. See `Surface.fillText`.
   *
   * **`KNOWN_GAPS` is empty.** Every record of every fixture agrees -- 133,410
   * of them across 37 recordings on four displays. The maximum width metric
   * for Courier New at twenty-two was the last thing this list named, and it
   * had been closed for some time before anyone checked: all eighteen of those
   * records agree on both displays, the `max` field included, and they live in
   * `maxwidth` rather than in `widths`.
   *
   * What is not checked is 3,863 records the suite reports as **unsupported**,
   * which is a different thing from a disagreement and is why they are counted
   * apart. They are not the same kind of thing as each other.
   *
   * `stack` is 3,650 of them and is an instrument: the scaler's own working
   * memory, read to find where a number came from, which nothing here is meant
   * to reproduce.
   *
   * `fotmake` is the other 213 and is a recording of a **real API function**.
   * `CreateScalableFontResource` is documented and callable, and a faithful
   * Windows 3.1 would write the `.FOT` stubs it writes; having no adapter is a
   * statement about this implementation rather than about the record. So
   * `FONTS.md` section 8c decodes it field by field -- the NE layout, both
   * resources, and every value of the `FONTDIR` entry beside the `.TTF` field
   * it comes from -- and an adapter written later has the whole of what it
   * needs without recording the probe again.
   */
};

/**
 * Functions a module declares but wires to a stub.
 *
 * Kept as an explicit list so that a stub reports as unimplemented rather than
 * as a disagreement -- the two want different work, and conflating them makes
 * the report harder to act on.
 */
const STUBBED = new Set<string>([]);

/**
 * Runs one recorded call.
 *
 * Asynchronous because some of the functions are: anything that reads a file
 * suspends its task on the real thing, and the profile calls read one on every
 * lookup.
 */
export async function replayRecord(
  record: Fixture['records'][number],
  display = 'vga'
): Promise<Replayed> {
  const base = { function: record.function, args: record.args, expected: record.result };

  await prepareFonts(display);

  if (STUBBED.has(record.function)) {
    return { ...base, actual: null, outcome: 'unimplemented' };
  }

  const adapter = ADAPTERS[record.function];

  if (!adapter) {
    return { ...base, actual: null, outcome: 'unsupported' };
  }

  let actual: string;

  try {
    actual = await adapter(new Context(display), parseArgs(record.args));
  } catch (error) {
    if (error instanceof Unimplemented) {
      return { ...base, actual: null, outcome: 'unimplemented' };
    }

    if (error instanceof NeedsDrive) {
      return { ...base, actual: null, outcome: 'unsupported' };
    }

    return {
      ...base,
      actual: `threw ${error instanceof Error ? error.message : String(error)}`,
      outcome: 'disagreed',
    };
  }

  return {
    ...base,
    actual,
    outcome: actual === record.result ? 'agreed' : 'disagreed',
  };
}

export interface Summary {
  total: number;
  agreed: number;
  byFunction: Map<string, { total: number; agreed: number; outcome: Outcome }>;
}

/**
 * Replays every record in a fixture and summarises the result.
 *
 * In order, one at a time, because a probe's records are not independent: the
 * write records change the file the reads that follow them look at, and the
 * recording captured them happening in sequence.
 */
export async function replayFixture(fixture: Fixture) {
  const replayed: Replayed[] = [];

  for (const record of fixture.records) {
    replayed.push(await replayRecord(record, fixture.display ?? 'vga'));
  }

  const byFunction = new Map<string, { total: number; agreed: number; outcome: Outcome }>();

  for (const record of replayed) {
    const entry = byFunction.get(record.function) ?? {
      total: 0,
      agreed: 0,
      outcome: record.outcome,
    };

    entry.total++;
    entry.agreed += record.outcome === 'agreed' ? 1 : 0;

    // A function is only as good as its worst record.
    if (record.outcome !== 'agreed') {
      entry.outcome = record.outcome;
    }

    byFunction.set(record.function, entry);
  }

  const summary: Summary = {
    total: replayed.length,
    agreed: replayed.filter((record) => record.outcome === 'agreed').length,
    byFunction,
  };

  return { replayed, summary };
}

/** Every fixture the recorder has produced. */
export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES)) {
    return [];
  }

  /* Only the top level. `fabricated/` holds recordings made against fonts
   * nobody has, which exist to answer a question about the interpreter and
   * would be nonsense to compare against the fonts we do have.
   */
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')));
}
