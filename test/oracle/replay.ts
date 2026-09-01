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
export async function prepareFonts() {
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

  const manager: any = new FontManager();

  for (const entry of await fileSystem.list(['WINDOWS', 'SYSTEM'])) {
    if (/\.(FON|TTF)$/.test(entry.info.name.toUpperCase())) {
      await manager.load(await fileSystem.open(['WINDOWS', 'SYSTEM', entry.info.name]));
    }
  }

  const profile = await fileSystem.open(['WINDOWS', 'WIN.INI']);

  if (profile) {
    const text = new Uint8Array(await profile.read(0, profile.size));

    windowsProfile = Array.from(text, (byte) => String.fromCharCode(byte)).join('');
  }

  fonts = manager;

  return fonts;
}

/**
 * The string `oracle/probes/font.c` measures every mapped font with.
 *
 * Has to match the probe's `SPECIMEN` exactly: the recorded widths are widths
 * of this text, and measuring anything else compares two different questions.
 */
const FONT_SPECIMEN = 'Wg jpq 128';

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
class Context {
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
    this.fonts = fonts;
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
  drawGlyph(font: any, character: string) {
    const surface: any = Surface.offscreen(32, 32);

    surface.font = font;

    // White to start with, as `PatBlt(..., WHITENESS)` left it.
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 32, 32);

    surface.fillText(2, 0, character);

    const pixels = surface.context.pixels;

    let hex = '';

    for (let row = 0; row < 32; row++) {
      for (let group = 0; group < 4; group++) {
        let byte = 0;

        for (let bit = 0; bit < 8; bit++) {
          const at = (row * 32 + group * 8 + bit) * 4;

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

  'CreateFont widths'(context, args) {
    const tm = context.mappedFont(args).metrics;

    return (
      `ave=${tm.tmAveCharWidth},max=${tm.tmMaxCharWidth},` +
      `weight=${tm.tmWeight},overhang=${tm.tmOverhang}`
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

    const character = String(args[args.length - 1] ?? '').replace(/'/g, '');
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
      : asked.replace(/'/g, '');

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
        lfWeight: fields.weight ?? 0,
        lfItalic: fields.italic ?? 0,
        lfCharSet: 0,
        lfFaceName: String(args[0]),
      });

      if (!handle) {
        throw new Unimplemented('no font mapped');
      }

      font = context.handles.resolve(handle);
    }

    return context.drawGlyph(font, character);
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
 * had never been drawn either, and both are ordinary simple glyphs: the middle
 * dot and the right guillemet. Those are what is left, and they are a hinting
 * question rather than a composite one.
 */
export const KNOWN_GAPS: Record<string, string> = {
  glyph: 'twenty-three cells of 2,574: the middle dot in three faces and one guillemet',
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
