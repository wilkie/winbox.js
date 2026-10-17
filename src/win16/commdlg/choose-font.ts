'use strict';

import { Arg, B, D, W, api, buffer, rectBytes, rectOf, stringOf, text } from './api.js';
import {
  callHook,
  instance,
  nextNumber,
  ownTemplate,
  freeTemplate,
  procAddress,
  registered,
  setError,
} from './guest-calls.js';
import { COMMDLG_STRINGS } from './strings.js';
import { FONT_BITMAP, FONT_COLOURS, FONT_TEMPLATE } from './templates.js';

/**
 * COMMDLG's Font dialog: `ChooseFont` (15), its procedure
 * `FormatCharDlgProc` (16), and the two procedures it gives GDI's
 * `EnumFontFamilies`, `FontStyleEnumProc` (18) and `FontFamilyEnumProc`
 * (19). **Read out** of `COMMDLG.DLL` seg4 and **recorded** by `chfont` and
 * `chfont2`; each step is COMMDLG's, at the address the comments give
 * ([[topic:choose-font]] in the knowledge base), and each call into USER,
 * GDI and KERNEL is made as COMMDLG makes it (`api.ts`). The twin of
 * `crates/winbox-win16/src/commdlg/choose_font.rs`.
 *
 * Where COMMDLG runs on Windows 3.0 (`[0CAEh]` below 30Ah) it takes other
 * ways -- `EnumFonts` for `EnumFontFamilies`, a private notification 5F4h,
 * lists invalidated after they fill; WinBox is Windows 3.10, and only the
 * 3.10 ways are followed.
 */

type Rect = [number, number, number, number];

const WM_SETREDRAW = 0x000b;
const WM_PAINT = 0x000f;
const WM_SYSCOLORCHANGE = 0x0015;
const WM_NEXTDLGCTL = 0x0028;
const WM_DRAWITEM = 0x002b;
const WM_MEASUREITEM = 0x002c;
const WM_GETFONT = 0x0031;
const WM_INITDIALOG = 0x0110;
const WM_COMMAND = 0x0111;
/** `WM_CHOOSEFONT_GETLOGFONT`, `WM_USER + 1`. */
const WM_CHOOSEFONT_GETLOGFONT = 0x0401;

const CB_LIMITTEXT = 0x0401;
const CB_SETEDITSEL = 0x0402;
const CB_ADDSTRING = 0x0403;
const CB_DELETESTRING = 0x0404;
const CB_GETCOUNT = 0x0406;
const CB_GETCURSEL = 0x0407;
const CB_GETLBTEXT = 0x0408;
const CB_INSERTSTRING = 0x040a;
const CB_RESETCONTENT = 0x040b;
const CB_SETCURSEL = 0x040e;
const CB_GETITEMDATA = 0x0410;
const CB_SETITEMDATA = 0x0411;
const CB_SETITEMHEIGHT = 0x0413;
const CB_GETITEMHEIGHT = 0x0414;

const CBN_SELCHANGE = 1;
const CBN_KILLFOCUS = 4;
const CBN_EDITUPDATE = 6;
/** COMMDLG's own notification, posted for a name typed: chosen where it is listed whole (`0ece`, `0f6a`). */
const TYPED = 0x05f5;

const IDOK = 1;
const IDCANCEL = 2;
const IDABORT = 3;
const PSH_APPLY = 0x0402;
const PSH_HELP = 0x040e;
const CHX_STRIKEOUT = 0x0410;
const CHX_UNDERLINE = 0x0411;
const GRP_EFFECTS = 0x0430;
const STC_COLOR = 0x0443;
const STC_SAMPLE = 0x0444;
const STC_DESCRIPTION = 0x0445;
const CMB_FACES = 0x0470;
const CMB_STYLES = 0x0471;
const CMB_SIZES = 0x0472;
const CMB_COLORS = 0x0473;

const CF_SCREENFONTS = 0x00000001;
const CF_PRINTERFONTS = 0x00000002;
const CF_SHOWHELP = 0x00000004;
const CF_ENABLEHOOK = 0x00000008;
const CF_ENABLETEMPLATE = 0x00000010;
const CF_ENABLETEMPLATEHANDLE = 0x00000020;
const CF_INITTOLOGFONTSTRUCT = 0x00000040;
const CF_USESTYLE = 0x00000080;
const CF_EFFECTS = 0x00000100;
const CF_APPLY = 0x00000200;
const CF_ANSIONLY = 0x00000400;
const CF_NOVECTORFONTS = 0x00000800;
const CF_NOSIMULATIONS = 0x00001000;
const CF_LIMITSIZE = 0x00002000;
const CF_FIXEDPITCHONLY = 0x00004000;
const CF_WYSIWYG = 0x00008000;
const CF_FORCEFONTEXIST = 0x00010000;
const CF_SCALABLEONLY = 0x00020000;
const CF_TTONLY = 0x00040000;
const CF_NOFACESEL = 0x00080000;
const CF_NOSTYLESEL = 0x00100000;
const CF_NOSIZESEL = 0x00200000;

const RASTER_FONTTYPE = 0x0001;
const TRUETYPE_FONTTYPE = 0x0004;
const BOLD_FONTTYPE = 0x0100;
const ITALIC_FONTTYPE = 0x0200;
const REGULAR_FONTTYPE = 0x0400;
const SCREEN_FONTTYPE = 0x2000;
const PRINTER_FONTTYPE = 0x4000;
const SIMULATED_FONTTYPE = 0x8000;
/** A device face of the printer's: `PRINTER_FONTTYPE` and `DEVICE_FONTTYPE` (`2030`, `260b`). */
const PRINTER_DEVICE = 0x4002;

const CDERR_STRUCTSIZE = 0x0001;
const CDERR_FINDRESFAILURE = 0x0006;
const CDERR_LOADRESFAILURE = 0x0007;
const CDERR_NOHOOK = 0x000b;
const CDERR_DIALOGFAILURE = 0xffff;
const CFERR_NOFONTS = 0x2001;
const CFERR_MAXLESSTHANMIN = 0x2002;

const COLOR_HIGHLIGHT = 0x0d;
const COLOR_HIGHLIGHTTEXT = 0x0e;
const COLOR_WINDOW = 0x05;
const COLOR_WINDOWTEXT = 0x08;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const LOGPIXELSY = 90;
const ETO_OPAQUE = 0x0002;
const ETO_CLIPPED = 0x0004;
const SRCCOPY = 0x00cc0020;
const MB_ICONINFORMATION = 0x0040;
const RT_DIALOG = 5;
const IDC_ARROW = 0x7f00;
const IDC_WAIT = 0x7f02;
const MM_TEXT = 1;
const MM_ISOTROPIC = 7;
const MM_ANISOTROPIC = 8;
/** `EnumFontFamilies`, GDI's ordinal 330, found by `GetProcAddress` (`1250`). */
const ENUM_FONT_FAMILIES = 330;
/** What `LoadString` is given for a style's name, and for a colour's. */
const STYLE_NAME_SIZE = 0x20;
const COLOUR_NAME_SIZE = 0x10;

/** The ordinals COMMDLG hands out. */
const FORMAT_CHAR_DLG_PROC = 16;
const FONT_STYLE_ENUM_PROC = 18;
const FONT_FAMILY_ENUM_PROC = 19;

// CHOOSEFONT's fields.
const LSTRUCTSIZE = 0x00;
const HWND_OWNER = 0x04;
const HDC = 0x06;
const LP_LOGFONT = 0x08;
const I_POINT_SIZE = 0x0c;
const FLAGS = 0x0e;
const RGB_COLORS = 0x12;
const HOOK = 0x1a;
const TEMPLATE_NAME = 0x1e;
const H_INSTANCE = 0x22;
const LPSZ_STYLE = 0x24;
const N_FONT_TYPE = 0x28;
const N_SIZE_MIN = 0x2a;
const N_SIZE_MAX = 0x2c;

// LOGFONT's.
const LF_HEIGHT = 0x00;
const LF_WEIGHT = 0x08;
const LF_ITALIC = 0x0a;
const LF_UNDERLINE = 0x0b;
const LF_STRIKEOUT = 0x0c;
const LF_CHARSET = 0x0d;
const LF_PITCH_AND_FAMILY = 0x11;
const LF_FACENAME = 0x12;
const LOGFONT_SIZE = 0x32;
const FW_NORMAL = 400;
const FW_BOLD = 700;

/** The standard sizes listed for a font that is not raster (`1745`). */
const STANDARD_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** What COMMDLG keeps for its Font dialogs in its data. As `FontGlobals`. */
type FontGlobals = {
  /** `[17Ah]`: the hook, kept while the dialog is made. */
  hook: number;
  /** `[170h]`: the pictures of the faces' types, made once from bitmap 38. */
  bitmap: number;
  /** `[0A86h]`: the sample's rectangle, client coordinates. */
  sample: Rect;
  /** `[0A82h]`: the style's type the description was last given for. */
  described: number;
  /** Each dialog's structure, by the number under its property A000h (`0428`). */
  dialogs: Map<number, number>;
  /** Each style's copy of its `LOGFONT`, by the number its row's data holds in its low word (`157a`). */
  styles: Map<number, number[]>;
  /** The last such number given. */
  nextStyle: number;
};

function globals(system: any): FontGlobals {
  const state = (system._commdlg ??= { error: 0, initialising: false });

  return (state.font ??= {
    hook: 0,
    bitmap: 0,
    sample: [0, 0, 0, 0],
    described: 0,
    dialogs: new Map(),
    styles: new Map(),
    nextStyle: 0,
  });
}

const s16 = (value: number) => (value << 16) >> 16;
const u16 = (value: number) => value & 0xffff;

const at = (far: number, step: number) => ((far & 0xffff0000) | ((far + step) & 0xffff)) >>> 0;

function bytes(system: any, far: number, step: number, length: number): number[] {
  const core = system.machine.cpu.core;
  const place = at(far, step);

  return Array.from({ length }, (_, i) =>
    core.read8(place >>> 16, ((place & 0xffff) + i) & 0xffff)
  );
}

const byte = (system: any, far: number, step: number) => bytes(system, far, step, 1)[0];

function word(system: any, far: number, step: number) {
  const b = bytes(system, far, step, 2);

  return b[0] | (b[1] << 8);
}

function dword(system: any, far: number, step: number) {
  const b = bytes(system, far, step, 4);

  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
}

function put(system: any, far: number, step: number, value: number[]) {
  const core = system.machine.cpu.core;
  const place = at(far, step);

  value.forEach((b, i) => core.write8(place >>> 16, ((place & 0xffff) + i) & 0xffff, b & 0xff));
}

const putWord = (system: any, far: number, step: number, value: number) =>
  put(system, far, step, [value & 0xff, (value >> 8) & 0xff]);

const putDword = (system: any, far: number, step: number, value: number) =>
  put(system, far, step, [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);

function readString(system: any, far: number): number[] {
  const out: number[] = [];

  for (let step = 0; step < 0x10000; step++) {
    const b = byte(system, far, step);

    if (!b) {
      break;
    }

    out.push(b);
  }

  return out;
}

const flagsOf = (system: any, lpcf: number) => dword(system, lpcf, FLAGS);

/** A flag of the program's `Flags` set or cleared. */
function setFlag(system: any, lpcf: number, flag: number, on: boolean) {
  const value = flagsOf(system, lpcf);

  putDword(system, lpcf, FLAGS, on ? (value | flag) >>> 0 : (value & ~flag) >>> 0);
}

/** One of COMMDLG's strings, as `LoadString` gives it into a buffer of `size` bytes. */
function string(id: number, size: number): number[] {
  const value = COMMDLG_STRINGS.get(id) ?? '';

  return Array.from(value, (c) => c.charCodeAt(0) & 0xff).slice(0, Math.max(0, size - 1));
}

/** A string with its `%d`s filled, as `wsprintf` fills them. */
function format(textBytes: number[], numbers: number[]): number[] {
  const out: number[] = [];
  let next = 0;

  for (let i = 0; i < textBytes.length; i++) {
    if (textBytes[i] === 0x25 && textBytes[i + 1] === 0x64) {
      out.push(...digits(numbers[next++] ?? 0));
      i++;
    } else {
      out.push(textBytes[i]);
    }
  }

  return out;
}

const digits = (value: number) => Array.from(String(s16(value)), (c) => c.charCodeAt(0));

const lfWord = (lf: number[], step: number) => lf[step] | (lf[step + 1] << 8);

function setLfWord(lf: number[], step: number, value: number) {
  lf[step] = value & 0xff;
  lf[step + 1] = (value >> 8) & 0xff;
}

async function call(system: any, module: string, name: string, args: Arg[]) {
  return (await api(system, module, name, args)).value;
}

const item = async (system: any, dialog: number, id: number) =>
  u16(await call(system, 'USER', 'GetDlgItem', [W(dialog), W(id)]));

const send = async (system: any, hwnd: number, message: number, wParam: number, lParam: number) =>
  call(system, 'USER', 'SendMessage', [W(hwnd), W(message), W(wParam), D(lParam)]);

/** `SendMessage` with bytes of COMMDLG's for `lParam`: its answer and the bytes as they were left. */
async function sendBytes(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  value: number[]
): Promise<[number, number[]]> {
  const called = await api(system, 'USER', 'SendMessage', [
    W(hwnd),
    W(message),
    W(wParam),
    B(value),
  ]);

  return [called.value, called.buffers[0]];
}

const sendItem = async (
  system: any,
  dialog: number,
  id: number,
  message: number,
  wParam: number,
  lParam: number
) =>
  call(system, 'USER', 'SendDlgItemMessage', [W(dialog), W(id), W(message), W(wParam), D(lParam)]);

const sendItemBytes = async (
  system: any,
  dialog: number,
  id: number,
  message: number,
  wParam: number,
  value: number[]
) =>
  call(system, 'USER', 'SendDlgItemMessage', [W(dialog), W(id), W(message), W(wParam), B(value)]);

/** A call that fills a buffer of `size` bytes, given as `buffer(size)`: its answer and the buffer's string. */
async function intoBuffer(
  system: any,
  module: string,
  name: string,
  args: Arg[]
): Promise<[number, number[]]> {
  const called = await api(system, module, name, args);

  return [called.value, stringOf(called)];
}

const getDc = async (system: any, hwnd: number) =>
  u16(await call(system, 'USER', 'GetDC', [W(hwnd)]));

const releaseDc = async (system: any, hwnd: number, hdc: number) =>
  call(system, 'USER', 'ReleaseDC', [W(hwnd), W(hdc)]);

const deviceCaps = async (system: any, hdc: number, index: number) =>
  s16(await call(system, 'GDI', 'GetDeviceCaps', [W(hdc), W(index)]));

const mulDiv = async (system: any, a: number, b: number, c: number) =>
  s16(await call(system, 'GDI', 'MulDiv', [W(a), W(b), W(c)]));

const sysColour = async (system: any, index: number) =>
  (await call(system, 'USER', 'GetSysColor', [W(index)])) >>> 0;

const setBkColour = async (system: any, hdc: number, colour: number) =>
  (await call(system, 'GDI', 'SetBkColor', [W(hdc), D(colour)])) >>> 0;

const setTextColour = async (system: any, hdc: number, colour: number) =>
  (await call(system, 'GDI', 'SetTextColor', [W(hdc), D(colour)])) >>> 0;

const select = async (system: any, hdc: number, object: number) =>
  u16(await call(system, 'GDI', 'SelectObject', [W(hdc), W(object)]));

const deleteObject = async (system: any, object: number) =>
  call(system, 'GDI', 'DeleteObject', [W(object)]);

const metric = async (system: any, index: number) =>
  s16(await call(system, 'USER', 'GetSystemMetrics', [W(index)]));

/** `GetTextMetrics`: the structure's 31 bytes. */
const textMetrics = async (system: any, hdc: number) =>
  (await api(system, 'GDI', 'GetTextMetrics', [W(hdc), buffer(0x1f)])).buffers[0];

/** `ExtTextOut` with a rectangle and text of COMMDLG's, or none, no widths. */
async function extTextOut(
  system: any,
  hdc: number,
  x: number,
  y: number,
  options: number,
  rect: Rect,
  value: number[] | null
) {
  await api(system, 'GDI', 'ExtTextOut', [
    W(hdc),
    W(x),
    W(y),
    W(options),
    B(rectBytes(rect)),
    value ? text(value) : D(0),
    W(value ? value.length : 0),
    D(0),
  ]);
}

/** A control hidden and disabled (`0229`): `EnableWindow`, then `ShowWindow`. */
async function hide(system: any, dialog: number, id: number) {
  await call(system, 'USER', 'EnableWindow', [W(await item(system, dialog, id)), W(0)]);
  await call(system, 'USER', 'ShowWindow', [W(await item(system, dialog, id)), W(0)]);
}

/** A style's copy of its `LOGFONT`, by the low word of its row's data. */
function styleFont(system: any, handle: number): number[] {
  return (globals(system).styles.get(handle) ?? new Array(LOGFONT_SIZE).fill(0)).slice();
}

// ---------------------------------------------------------------------
// The lists' small helpers.

/** The row whose text is `value`, by `lstrcmpi`, or -1 (`0a18`). */
async function findExact(system: any, combo: number, value: number[]) {
  const count = s16(await send(system, combo, CB_GETCOUNT, 0, 0));

  for (let index = 0; index < count; index++) {
    const [, row] = await sendBytes(system, combo, CB_GETLBTEXT, index, new Array(0x24).fill(0));
    const compared = await call(system, 'USER', 'lstrcmpi', [text(terminated(row)), text(value)]);

    if (u16(compared) === 0) {
      return index;
    }
  }

  return -1;
}

function terminated(b: number[]) {
  const end = b.indexOf(0);

  return end < 0 ? b.slice() : b.slice(0, end);
}

/** The row whose text is `value` chosen, where there is one (`0995`). */
async function chooseExact(system: any, combo: number, value: number[]) {
  const index = await findExact(system, combo, value);

  if (index >= 0) {
    await send(system, combo, CB_SETCURSEL, index, 0);
  }

  return index;
}

/** The row chosen's text put in the box (`094f`): the row, or -1. */
async function selectionToBox(system: any, combo: number) {
  const index = s16(await send(system, combo, CB_GETCURSEL, 0, 0));

  if (index >= 0) {
    const [, row] = await sendBytes(system, combo, CB_GETLBTEXT, index, new Array(0x20).fill(0));

    await call(system, 'USER', 'SetWindowText', [W(combo), text(terminated(row))]);
  }

  return index;
}

/** The box's text, at most `size` bytes, and the row it names whole with that row's data (`09c8`). */
async function boxRow(
  system: any,
  combo: number,
  size: number
): Promise<[number[], number, number]> {
  const [, value] = await intoBuffer(system, 'USER', 'GetWindowText', [
    W(combo),
    buffer(size),
    W(size),
  ]);
  const index = await findExact(system, combo, value);
  const data = index >= 0 ? (await send(system, combo, CB_GETITEMDATA, index, 0)) >>> 0 : 0;

  return [value, index, data];
}

/**
 * The style nearest a `LOGFONT`'s weight chosen (`088c`): first among those
 * of its italic, then, where that found only the first row, among all, the
 * best difference carried over.
 */
async function nearestStyle(system: any, combo: number, lf: number) {
  let best = 1000;
  const count = s16(await send(system, combo, CB_GETCOUNT, 0, 0));
  let chosen = 0;
  let all = false;
  const weight = s16(word(system, lf, LF_WEIGHT));
  const italic = byte(system, lf, LF_ITALIC) !== 0;

  for (;;) {
    for (let index = 0; index < count; index++) {
      const handle = u16(await send(system, combo, CB_GETITEMDATA, index, 0));
      const style = styleFont(system, handle);
      const theirs = style[LF_ITALIC] !== 0;

      if (!all && theirs !== italic) {
        continue;
      }

      const difference = Math.abs(s16(weight - s16(lfWord(style, LF_WEIGHT))));

      if (best > difference) {
        best = difference;
        chosen = index;
      }
    }

    if (all || chosen !== 0) {
      break;
    }

    all = true;
  }

  await send(system, combo, CB_SETCURSEL, chosen, 0);
}

/**
 * A style chosen for the program's `LOGFONT` (`016d`): with `CF_USESTYLE` as
 * the dialog starts, the one `lpszStyle` names, its weight and italic
 * written into the `LOGFONT`, or weight 400 and not italic where none has
 * that name; else the nearest. Nothing with `CF_NOSTYLESEL`.
 */
async function chooseStyle(system: any, hwnd: number, lpcf: number, starting: boolean) {
  const flags = flagsOf(system, lpcf);

  if (flags & CF_NOSTYLESEL) {
    return;
  }

  const styles = await item(system, hwnd, CMB_STYLES);
  const lf = dword(system, lpcf, LP_LOGFONT);

  if (starting && flags & CF_USESTYLE) {
    const name = readString(system, dword(system, lpcf, LPSZ_STYLE));
    const index = await chooseExact(system, styles, name);

    if (index >= 0) {
      const handle = u16(await sendItem(system, hwnd, CMB_STYLES, CB_GETITEMDATA, index, 0));
      const style = styleFont(system, handle);

      putWord(system, lf, LF_WEIGHT, lfWord(style, LF_WEIGHT));
      put(system, lf, LF_ITALIC, [style[LF_ITALIC]]);
    } else {
      putWord(system, lf, LF_WEIGHT, FW_NORMAL);
      put(system, lf, LF_ITALIC, [0]);
    }
  } else {
    await nearestStyle(system, styles, lf);
  }

  await selectionToBox(system, await item(system, hwnd, CMB_STYLES));
}

/**
 * The default `LOGFONT` (`1a2a`): weight 400, ten points high on the
 * screen, the rest nought and the face empty -- the bytes of the face after
 * its first left as they were.
 */
async function defaultLogfontBytes(system: any, lf: number[]) {
  setLfWord(lf, LF_WEIGHT, FW_NORMAL);
  lf.fill(0, LF_CHARSET, LF_CHARSET + 5);
  lf[LF_ITALIC] = 0;
  lf[LF_STRIKEOUT] = 0;
  lf[LF_UNDERLINE] = 0;
  lf.fill(0, 2, 8);
  lf[LF_FACENAME] = 0;

  const hdc = await getDc(system, 0);
  const pixels = await deviceCaps(system, hdc, LOGPIXELSY);
  const height = await mulDiv(system, 10, pixels, 72);

  setLfWord(lf, LF_HEIGHT, -height);
  await releaseDc(system, 0, hdc);
}

/** The default `LOGFONT` written to the program's (`1a2a`). */
async function defaultFont(system: any, lf: number) {
  const value = bytes(system, lf, 0, LOGFONT_SIZE);

  await defaultLogfontBytes(system, value);
  put(system, lf, 0, value);
}

/** A size in points on a device, from a height in its pixels, and its text (`267c`). */
async function points(system: any, hdc: number, height: number): Promise<[number, number[]]> {
  const pixels = await deviceCaps(system, hdc, LOGPIXELSY);
  const size = await mulDiv(system, Math.abs(s16(height)), 72, pixels);

  return [size, digits(size)];
}

/** A size added to the sizes' list in order by its number, once, and with `CF_LIMITSIZE` only within the limits (`1400`). */
async function addSize(system: any, lpcf: number, size: number, sizes: number) {
  if (
    flagsOf(system, lpcf) & CF_LIMITSIZE &&
    (size > s16(word(system, lpcf, N_SIZE_MAX)) || size < s16(word(system, lpcf, N_SIZE_MIN)))
  ) {
    return;
  }

  const count = s16(await send(system, sizes, CB_GETCOUNT, 0, 0));
  let last = -1;
  let index = 0;

  while (index < count) {
    last = s16(await send(system, sizes, CB_GETITEMDATA, index, 0));

    if (last >= size) {
      break;
    }

    index++;
  }

  if (last === size) {
    return;
  }

  const [placed] = await sendBytes(system, sizes, CB_INSERTSTRING, index, [...digits(size), 0]);

  if (s16(placed) >= 0) {
    await send(system, sizes, CB_SETITEMDATA, u16(placed), u16(size));
  }
}

/** The sixteen standard sizes (`1745`). */
async function standardSizes(system: any, lpcf: number, sizes: number) {
  for (const size of STANDARD_SIZES) {
    await addSize(system, lpcf, size, sizes);
  }
}

/** A style's name inserted by its weight, an italic after the upright of its weight (`14bb`): its row, or below nought. */
async function insertStyle(system: any, combo: number, name: number[], lf: number[]) {
  const count = s16(await send(system, combo, CB_GETCOUNT, 0, 0));
  const weight = s16(lfWord(lf, LF_WEIGHT));
  const italic = lf[LF_ITALIC] !== 0;
  let index = 0;

  while (index < count) {
    const handle = u16(await send(system, combo, CB_GETITEMDATA, index, 0));
    const theirs = styleFont(system, handle);
    const theirWeight = s16(lfWord(theirs, LF_WEIGHT));

    if (theirWeight > weight) {
      break;
    }

    if (theirWeight === weight) {
      if (italic && theirs[LF_ITALIC] === 0) {
        index++;
      }

      break;
    }

    index++;
  }

  return s16((await sendBytes(system, combo, CB_INSERTSTRING, index, [...name, 0]))[0]);
}

/** A style added where its name is not listed (`153e`): its copy of its `LOGFONT` kept, the row's data that copy's number and its type. */
async function addStyle(system: any, combo: number, name: number[], kind: number, lf: number[]) {
  if ((await findExact(system, combo, name)) >= 0) {
    return;
  }

  const index = await insertStyle(system, combo, name, lf);

  if (index < 0) {
    return;
  }

  const state = globals(system);

  state.nextStyle = (state.nextStyle + 1) & 0xffff || 1;

  while (state.styles.has(state.nextStyle)) {
    state.nextStyle = (state.nextStyle + 1) & 0xffff || 1;
  }

  const handle = state.nextStyle;

  state.styles.set(handle, lf.slice(0, LOGFONT_SIZE));
  await send(system, combo, CB_SETITEMDATA, index, ((kind << 16) | handle) >>> 0);
}

/** The styles a face lacks made from those it has (`15ce`), each typed with the last listed style's type, `SIMULATED_FONTTYPE` and its own bits. */
async function simulate(system: any, combo: number) {
  const count = s16(await send(system, combo, CB_GETCOUNT, 0, 0));
  let italicOf = 0;
  let boldOf = 0;
  let regularOf = 0;
  let boldItalic = false;
  let italic = false;
  let bold = false;
  let kind = 0;

  for (let index = 0; index < count; index++) {
    const data = (await send(system, combo, CB_GETITEMDATA, index, 0)) >>> 0;
    const handle = data & 0xffff;

    kind = data >>> 16;

    if (kind & BOLD_FONTTYPE && kind & ITALIC_FONTTYPE) {
      boldItalic = true;
    } else if (kind & BOLD_FONTTYPE) {
      bold = true;
      boldOf = handle;
    } else if (kind & ITALIC_FONTTYPE) {
      italic = true;
      italicOf = handle;
    } else {
      regularOf = handle;
    }
  }

  kind |= SIMULATED_FONTTYPE;

  if (!bold && regularOf) {
    const lf = styleFont(system, regularOf);

    setLfWord(lf, LF_WEIGHT, FW_BOLD);
    await addStyle(system, combo, string(0x505, STYLE_NAME_SIZE), kind | BOLD_FONTTYPE, lf);
  }

  if (!italic && regularOf) {
    const lf = styleFont(system, regularOf);

    lf[LF_ITALIC] = 1;
    await addStyle(system, combo, string(0x506, STYLE_NAME_SIZE), kind | ITALIC_FONTTYPE, lf);
  }

  if (!boldItalic && (boldOf || italicOf || regularOf)) {
    const lf = styleFont(system, italicOf || boldOf || regularOf);

    lf[LF_ITALIC] = 1;
    setLfWord(lf, LF_WEIGHT, FW_BOLD);
    await addStyle(
      system,
      combo,
      string(0x507, STYLE_NAME_SIZE),
      kind | BOLD_FONTTYPE | ITALIC_FONTTYPE,
      lf
    );
  }
}

/** The styles' copies let go and the list emptied (`19d0`). */
async function freeStyles(system: any, combo: number) {
  const count = s16(await send(system, combo, CB_GETCOUNT, 0, 0));

  for (let index = 0; index < count; index++) {
    const handle = u16(await send(system, combo, CB_GETITEMDATA, index, 0));

    globals(system).styles.delete(handle);
  }

  await send(system, combo, CB_RESETCONTENT, 0, 0);
}

/** `EnumFontFamilies` found as COMMDLG finds it: `GetModuleHandle("GDI")` and `GetProcAddress` of its ordinal (`122d`, `1ab0`). */
async function enumerationFound(system: any) {
  const gdi = u16(await call(system, 'KERNEL', 'GetModuleHandle', [text([0x47, 0x44, 0x49])]));

  return (await call(system, 'KERNEL', 'GetProcAddress', [W(gdi), D(ENUM_FONT_FAMILIES)])) !== 0;
}

/** `EnumFontFamilies` with a face, or none, an export of COMMDLG's and the data it is given, laid out as COMMDLG's stack holds it. */
async function enumerate(
  system: any,
  hdc: number,
  face: number[] | null,
  ordinal: number,
  data: number[]
) {
  await api(system, 'GDI', 'EnumFontFamilies', [
    W(hdc),
    face ? text(face) : D(0),
    D(procAddress(system, ordinal)),
    B(data),
  ]);
}

function setDataWord(data: number[], step: number, value: number) {
  data[step] = value & 0xff;
  data[step + 1] = (value >> 8) & 0xff;
}

function setDataDword(data: number[], step: number, value: number) {
  setDataWord(data, step, value & 0xffff);
  setDataWord(data, step + 2, value >>> 16);
}

// ---------------------------------------------------------------------
// The faces (`1226`) and FontFamilyEnumProc (`1096`).

/** The faces listed (`1226`): whether any are. */
async function listFaces(system: any, hwnd: number, printer: number, flags: number) {
  if (!(await enumerationFound(system))) {
    return false;
  }

  const faces = await item(system, hwnd, CMB_FACES);
  const data = (hdc: number, printerPass: number) => {
    const value = new Array(0x16).fill(0);

    setDataWord(value, 0, faces);
    setDataWord(value, 6, hdc);
    setDataDword(value, 8, flags);
    setDataWord(value, 0x10, printerPass);
    return value;
  };
  const screen = await getDc(system, 0);

  await enumerate(system, screen, null, FONT_FAMILY_ENUM_PROC, data(screen, 0));
  await releaseDc(system, 0, screen);

  if (flags & CF_PRINTERFONTS) {
    await enumerate(system, printer, null, FONT_FAMILY_ENUM_PROC, data(printer, 1));
  }

  /* Faces only the screen has, without CF_SCREENFONTS (`12e0`); with
   * CF_WYSIWYG, faces not both the screen's and the printer's (`133d`). */
  for (const [wanted, keep] of [
    [!(flags & CF_SCREENFONTS), SCREEN_FONTTYPE],
    [!!(flags & CF_WYSIWYG), SCREEN_FONTTYPE | PRINTER_FONTTYPE],
  ] as [boolean, number][]) {
    if (!wanted) {
      continue;
    }

    const count = s16(await send(system, faces, CB_GETCOUNT, 0, 0));

    for (let index = count - 1; index >= 0; index--) {
      const kind = u16(await send(system, faces, CB_GETITEMDATA, index, 0));
      const bits = kind & (SCREEN_FONTTYPE | PRINTER_FONTTYPE);
      const gone = keep === SCREEN_FONTTYPE ? bits === SCREEN_FONTTYPE : bits !== keep;

      if (gone) {
        await send(system, faces, CB_DELETESTRING, index, 0);
      }
    }
  }

  if (s16(await send(system, faces, CB_GETCOUNT, 0, 0)) > 0) {
    return true;
  }

  await call(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(string(0x501, 0x64)),
    text(string(0x500, 0x28)),
    W(MB_ICONINFORMATION),
  ]);
  return false;
}

/**
 * Which of two faces' types ranks above (`1079`): TrueType, device, vector,
 * raster -- the screen and printer bits cleared and the raster bit flipped,
 * the new less the old.
 */
function ranksAbove(next: number, old: number) {
  const rank = (kind: number) =>
    (kind & ~(SCREEN_FONTTYPE | PRINTER_FONTTYPE) & 0xffff) ^ RASTER_FONTTYPE;

  return s16(rank(next) - rank(old)) > 0;
}

/**
 * `FontFamilyEnumProc` (`1096`): a face of GDI's taken, left out, or put in
 * place of the same face of a lower type.
 *
 * @returns {Types.INT} Nought to end the enumeration.
 */
export async function FontFamilyEnumProc(
  this: any,
  lpelf: number,
  _lpntm: number,
  fontType: number,
  data: number
) {
  return family(this, lpelf >>> 0, u16(fontType), data >>> 0);
}

async function family(system: any, lpelf: number, kind: number, data: number) {
  const combo = word(system, data, 0);
  const flags = dword(system, data, 8);
  const printer = word(system, data, 0x10) !== 0;
  const charset = byte(system, lpelf, LF_CHARSET);

  if (
    (flags & CF_TTONLY && !(kind & TRUETYPE_FONTTYPE)) ||
    (flags & CF_SCALABLEONLY && kind & RASTER_FONTTYPE) ||
    (flags & CF_ANSIONLY && charset !== 0) ||
    (flags & CF_FIXEDPITCHONLY && byte(system, lpelf, LF_PITCH_AND_FAMILY) & 2) ||
    (flags & CF_NOVECTORFONTS && charset === 0xff)
  ) {
    return 1;
  }

  kind |= printer ? PRINTER_FONTTYPE : SCREEN_FONTTYPE;

  const face = readString(system, at(lpelf, LF_FACENAME));
  const index = await findExact(system, combo, face);

  if (index < 0) {
    const [added] = await sendBytes(system, combo, CB_ADDSTRING, 0, [...face, 0]);

    if (s16(added) < 0) {
      return 0;
    }

    await send(system, combo, CB_SETITEMDATA, u16(added), kind);
    return 1;
  }

  let old = u16(await send(system, combo, CB_GETITEMDATA, index, 0));
  const printerOverScreen =
    !(flags & CF_SCREENFONTS) &&
    !!(flags & CF_PRINTERFONTS) &&
    !!(kind & PRINTER_FONTTYPE) &&
    !!(old & SCREEN_FONTTYPE);

  if (printerOverScreen) {
    old = 0;
  }

  let value: number;

  if (printerOverScreen || ranksAbove(kind, old)) {
    await sendBytes(system, combo, CB_INSERTSTRING, index, [...face, 0]);
    await send(system, combo, CB_DELETESTRING, index + 1, 0);
    value = kind;
  } else {
    value = old;
  }

  value |= (old | kind) & (SCREEN_FONTTYPE | PRINTER_FONTTYPE);
  await send(system, combo, CB_SETITEMDATA, index, value);
  return 1;
}

// ---------------------------------------------------------------------
// The styles and sizes (`1aaa`) and FontStyleEnumProc (`184e`).

/** The styles and sizes listed for the face chosen (`1aaa`). */
async function listStyles(system: any, hwnd: number, lpcf: number) {
  if (!(await enumerationFound(system))) {
    return;
  }

  await freeStyles(system, await item(system, hwnd, CMB_STYLES));

  const styles = await item(system, hwnd, CMB_STYLES);
  const sizes = await item(system, hwnd, CMB_SIZES);
  const flags = flagsOf(system, lpcf);
  const face = s16(await sendItem(system, hwnd, CMB_FACES, CB_GETCURSEL, 0, 0));

  if (face < 0) {
    /* No face: the four styles of the default LOGFONT, and the standard
     * sizes (`1b4b`). */
    const lf = new Array(LOGFONT_SIZE).fill(0);

    await defaultLogfontBytes(system, lf);
    await addStyle(system, styles, string(0x504, STYLE_NAME_SIZE), REGULAR_FONTTYPE, lf);
    setLfWord(lf, LF_WEIGHT, FW_BOLD);
    await addStyle(system, styles, string(0x505, STYLE_NAME_SIZE), BOLD_FONTTYPE, lf);
    setLfWord(lf, LF_WEIGHT, FW_NORMAL);
    lf[LF_ITALIC] = 1;
    await addStyle(system, styles, string(0x506, STYLE_NAME_SIZE), ITALIC_FONTTYPE, lf);
    setLfWord(lf, LF_WEIGHT, FW_BOLD);
    await addStyle(
      system,
      styles,
      string(0x507, STYLE_NAME_SIZE),
      BOLD_FONTTYPE | ITALIC_FONTTYPE,
      lf
    );
    await standardSizes(system, lpcf, sizes);
    return;
  }

  const kind = u16(await sendItem(system, hwnd, CMB_FACES, CB_GETITEMDATA, face, 0));

  await send(system, sizes, CB_RESETCONTENT, 0, 0);
  await send(system, sizes, WM_SETREDRAW, 0, 0);
  await send(system, styles, WM_SETREDRAW, 0, 0);

  const [, name] = await intoBuffer(system, 'USER', 'GetDlgItemText', [
    W(hwnd),
    W(CMB_FACES),
    buffer(0x20),
    W(0x20),
  ]);
  const data = (hdc: number, printer: number) => {
    const value = new Array(0x16).fill(0);

    setDataWord(value, 2, styles);
    setDataWord(value, 4, sizes);
    setDataWord(value, 6, hdc);
    setDataDword(value, 8, flags);
    setDataWord(value, 0x0c, kind);
    setDataWord(value, 0x0e, 1);
    setDataWord(value, 0x10, printer);
    setDataDword(value, 0x12, lpcf);
    return value;
  };

  if (flags & CF_SCREENFONTS) {
    const screen = await getDc(system, 0);

    await enumerate(system, screen, name, FONT_STYLE_ENUM_PROC, data(screen, 0));
    await releaseDc(system, 0, screen);
  }

  if (flags & CF_PRINTERFONTS) {
    const printer = word(system, lpcf, HDC);
    const mode = u16(await call(system, 'GDI', 'GetMapMode', [W(printer)]));
    let viewport = 0;
    let window = 0;

    if (mode !== MM_TEXT) {
      if (mode === MM_ISOTROPIC || mode === MM_ANISOTROPIC) {
        viewport = (await call(system, 'GDI', 'GetViewportExt', [W(printer)])) >>> 0;
        window = (await call(system, 'GDI', 'GetWindowExt', [W(printer)])) >>> 0;
      }

      await call(system, 'GDI', 'SetMapMode', [W(printer), W(MM_TEXT)]);
    }

    await enumerate(system, printer, name, FONT_STYLE_ENUM_PROC, data(printer, 1));

    if (mode !== MM_TEXT) {
      await call(system, 'GDI', 'SetMapMode', [W(printer), W(mode)]);

      if (mode === MM_ISOTROPIC || mode === MM_ANISOTROPIC) {
        await call(system, 'GDI', 'SetWindowExt', [W(printer), W(window), W(window >>> 16)]);
        await call(system, 'GDI', 'SetViewportExt', [W(printer), W(viewport), W(viewport >>> 16)]);
      }
    }
  }

  if (!(flags & CF_NOSIMULATIONS)) {
    await simulate(system, styles);
  }

  await send(system, styles, WM_SETREDRAW, 1, 0);
  await send(system, sizes, WM_SETREDRAW, 1, 0);
}

/**
 * `FontStyleEnumProc` (`184e`): a style of the face's own kind listed, and
 * the face's sizes.
 *
 * @returns {Types.INT} Always 1.
 */
export async function FontStyleEnumProc(
  this: any,
  lpelf: number,
  lpntm: number,
  fontType: number,
  data: number
) {
  return style(this, lpelf >>> 0, lpntm >>> 0, u16(fontType), data >>> 0);
}

async function style(system: any, lpelf: number, lpntm: number, kind: number, data: number) {
  const face = word(system, data, 0x0c);

  if ((face & 7) !== kind) {
    return 1;
  }

  const styles = word(system, data, 2);
  const sizes = word(system, data, 4);
  const hdc = word(system, data, 6);
  const lpcf = dword(system, data, 0x12);

  if (!(kind & RASTER_FONTTYPE)) {
    if (word(system, data, 0x0e) && u16(await send(system, sizes, CB_GETCOUNT, 0, 0)) === 0) {
      await standardSizes(system, lpcf, sizes);
    }
  } else {
    const height = s16(word(system, lpntm, 0) - word(system, lpntm, 6));
    const [size, value] = await points(system, hdc, height);

    if ((await findExact(system, sizes, value)) < 0) {
      await addSize(system, lpcf, size, sizes);
    }
  }

  kind |= face & (SCREEN_FONTTYPE | PRINTER_FONTTYPE);

  const lf = bytes(system, lpelf, 0, LOGFONT_SIZE);
  let name: number[];

  if (kind & TRUETYPE_FONTTYPE) {
    const flags = byte(system, lpntm, 0x1f);

    if (!(flags & 0x21)) {
      kind |= REGULAR_FONTTYPE;
    }

    if (flags & 0x01) {
      kind |= ITALIC_FONTTYPE;
    }

    if (flags & 0x20) {
      kind |= BOLD_FONTTYPE;
    }

    name = readString(system, at(lpelf, 0x72));
  } else {
    const heavy = s16(lfWord(lf, LF_WEIGHT)) >= FW_BOLD;
    const italic = lf[LF_ITALIC] !== 0;
    const [id, bits] = heavy
      ? italic
        ? [0x507, BOLD_FONTTYPE | ITALIC_FONTTYPE]
        : [0x505, BOLD_FONTTYPE]
      : italic
        ? [0x506, ITALIC_FONTTYPE]
        : [0x504, REGULAR_FONTTYPE];

    kind |= bits;
    name = string(id, STYLE_NAME_SIZE);
  }

  await addStyle(system, styles, name, kind, lf);
  return 1;
}

// ---------------------------------------------------------------------
// The call: ChooseFont (`0000`).

/**
 * Shows COMMDLG's Font dialog (`0000`).
 *
 * @param {Types.FARPTR} lpcf - The program's `CHOOSEFONT`.
 * @returns {Types.BOOL} Whether OK was pressed.
 */
export async function ChooseFont(this: any, lpcf: number) {
  return choose(this, lpcf >>> 0);
}

async function choose(system: any, lpcf: number) {
  const cursor = u16(await call(system, 'USER', 'LoadCursor', [W(0), D(IDC_WAIT)]));

  await call(system, 'USER', 'SetCursor', [W(cursor)]);
  setError(system, 0);

  if (dword(system, lpcf, LSTRUCTSIZE) !== 0x2e) {
    setError(system, CDERR_STRUCTSIZE);
    return 0;
  }

  const flags = flagsOf(system, lpcf);

  if (flags & CF_ENABLEHOOK && !dword(system, lpcf, HOOK)) {
    setError(system, CDERR_NOHOOK);
    return 0;
  }

  const program = word(system, lpcf, H_INSTANCE);
  let handle: number;
  let own = false;

  if (flags & CF_ENABLETEMPLATE) {
    const found = u16(
      await call(system, 'KERNEL', 'FindResource', [
        W(program),
        D(dword(system, lpcf, TEMPLATE_NAME)),
        D(RT_DIALOG),
      ])
    );

    if (!found) {
      setError(system, CDERR_FINDRESFAILURE);
      return 0;
    }

    handle = u16(await call(system, 'KERNEL', 'LoadResource', [W(program), W(found)]));

    if (!handle) {
      setError(system, CDERR_LOADRESFAILURE);
      return 0;
    }
  } else if (flags & CF_ENABLETEMPLATEHANDLE) {
    handle = program;
  } else {
    handle = await ownTemplate(system, FONT_TEMPLATE);
    own = true;

    if (!handle) {
      setError(system, CDERR_LOADRESFAILURE);
      return 0;
    }
  }

  let answer = 0;

  if ((await call(system, 'KERNEL', 'LockResource', [W(handle)])) >>> 0) {
    if (flags & CF_ENABLEHOOK) {
      globals(system).hook = dword(system, lpcf, HOOK);
    }

    answer = u16(
      await call(system, 'USER', 'DialogBoxIndirectParam', [
        W(instance(system)),
        W(handle),
        W(word(system, lpcf, HWND_OWNER)),
        D(procAddress(system, FORMAT_CHAR_DLG_PROC)),
        D(lpcf),
      ])
    );
    await call(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);
    globals(system).hook = 0;

    if (answer === 0xffff) {
      setError(system, CDERR_DIALOGFAILURE);
      answer = 0;
    }
  }

  /* The template let go unless it was the program's handle (`0147`). */
  if (own) {
    await freeTemplate(system, handle);
  } else if (!(flags & CF_ENABLETEMPLATEHANDLE)) {
    await call(system, 'KERNEL', 'FreeResource', [W(handle)]);
  }

  return answer === 1 ? 1 : 0;
}

// ---------------------------------------------------------------------
// The procedure: FormatCharDlgProc (`02b0`).

/**
 * The Font dialog's procedure, COMMDLG's export 16 (`02b0`).
 *
 * @returns {Types.BOOL} What a dialog procedure answers.
 */
export async function FormatCharDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return procedure(this, hwnd, message, wParam, lParam >>> 0);
}

/** The dialog's number under its property A000h: nought before `WM_INITDIALOG` puts it there. */
const numberOf = async (system: any, hwnd: number) =>
  u16(await call(system, 'USER', 'GetProp', [W(hwnd), D(0xa000)]));

async function procedure(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const id = await numberOf(system, hwnd);
  let lpcf = 0;

  if (id) {
    lpcf = globals(system).dialogs.get(id) ?? 0;

    if (flagsOf(system, lpcf) & CF_ENABLEHOOK) {
      const answer = await callHook(
        system,
        dword(system, lpcf, HOOK),
        hwnd,
        message,
        wParam,
        lParam
      );

      if (answer) {
        return answer;
      }
    }
  } else {
    const hook = globals(system).hook;

    if (hook && message !== WM_INITDIALOG) {
      const answer = await callHook(system, hook, hwnd, message, wParam, lParam);

      if (answer) {
        return answer;
      }
    }
  }

  switch (message) {
    case WM_PAINT: {
      const called = await api(system, 'USER', 'BeginPaint', [W(hwnd), buffer(32)]);
      const hdc = u16(called.value);

      if (hdc) {
        await paintSample(system, hwnd, lpcf, hdc);
        await api(system, 'USER', 'EndPaint', [W(hwnd), B(called.buffers[0])]);
      }

      return 1;
    }

    case WM_SYSCOLORCHANGE:
      await deleteObject(system, globals(system).bitmap);
      globals(system).bitmap = await makeBitmap(system);
      return 1;

    case WM_DRAWITEM:
      if (word(system, lParam, 4) !== 0xffff) {
        switch (word(system, lParam, 2)) {
          case CMB_COLORS:
            await drawColour(system, lParam);
            break;
          case CMB_FACES:
            await drawFace(system, lParam);
            break;
          default:
            await drawSize(system, lParam);
        }
      }

      return 1;

    case WM_MEASUREITEM:
      await measure(system, hwnd, lParam);
      return 1;

    case WM_INITDIALOG:
      return start(system, hwnd, message, wParam, lParam);

    case WM_COMMAND:
      return command(system, hwnd, lpcf, wParam, lParam >>> 16, lParam & 0xffff);

    case WM_CHOOSEFONT_GETLOGFONT:
      return logfont(system, hwnd, lpcf, lParam, true);

    default:
      return 0;
  }
}

/** `WM_MEASUREITEM` (`0787`): a row the dialog's font's height, at least 12; the edit field that height and one. */
async function measure(system: any, hwnd: number, lParam: number) {
  const hdc = await getDc(system, hwnd);
  let old = u16(await send(system, hwnd, WM_GETFONT, 0, 0));

  if (old) {
    old = await select(system, hdc, old);
  }

  const tm = await textMetrics(system, hdc);

  if (old) {
    await select(system, hdc, old);
  }

  await releaseDc(system, hwnd, hdc);

  const height = s16(lfWord(tm, 0));
  const value = word(system, lParam, 4) === 0xffff ? height + 1 : Math.max(height, 12);

  putWord(system, lParam, 8, value);
}

/** A row's colours set for its state, the highlight's for one selected: the old background and text colours. */
async function rowColours(system: any, hdc: number, selected: boolean): Promise<[number, number]> {
  const [back, fore] = selected
    ? [COLOR_HIGHLIGHT, COLOR_HIGHLIGHTTEXT]
    : [COLOR_WINDOW, COLOR_WINDOWTEXT];
  const oldBack = await setBkColour(system, hdc, await sysColour(system, back));
  const oldFore = await setTextColour(system, hdc, await sysColour(system, fore));

  return [oldBack, oldFore];
}

async function restoreColours(system: any, hdc: number, [back, fore]: [number, number]) {
  await setTextColour(system, hdc, fore);
  await setBkColour(system, hdc, back);
}

/** A `DRAWITEMSTRUCT`'s fields. */
type Drawn = {
  item: number;
  state: number;
  control: number;
  hdc: number;
  rect: Rect;
  data: number;
};

function drawn(system: any, far: number): Drawn {
  const b = bytes(system, far, 0, 26);
  const w = (step: number) => b[step] | (b[step + 1] << 8);

  return {
    item: w(4),
    state: w(8),
    control: w(0x0a),
    hdc: w(0x0c),
    rect: rectOf(b.slice(0x0e, 0x16)),
    data: (w(0x16) | (w(0x18) << 16)) >>> 0,
  };
}

/** A row's text, by `CB_GETLBTEXT` into a buffer of `size` bytes. */
async function rowText(system: any, d: Drawn, size: number) {
  return terminated(
    (await sendBytes(system, d.control, CB_GETLBTEXT, d.item, new Array(size).fill(0)))[1]
  );
}

/** A size's row (`1e67`): its number, `SM_CXBORDER` in. */
async function drawSize(system: any, far: number) {
  const d = drawn(system, far);
  const old = await rowColours(system, d.hdc, !!(d.state & 1));
  const value = await rowText(system, d, 0x0a);
  const border = await metric(system, SM_CXBORDER);

  await extTextOut(system, d.hdc, border + d.rect[0], d.rect[1], ETO_OPAQUE, d.rect, value);
  await restoreColours(system, d.hdc, old);
}

/** A face's row (`1f44`): its name 20 pixels in, and for a TrueType face or a printer's device face its picture from bitmap 38. */
async function drawFace(system: any, far: number) {
  const d = drawn(system, far);
  const old = await rowColours(system, d.hdc, !!(d.state & 1));
  const value = await rowText(system, d, 0x32);

  await extTextOut(system, d.hdc, d.rect[0] + 20, d.rect[1], ETO_OPAQUE, d.rect, value);

  const memory = u16(await call(system, 'GDI', 'CreateCompatibleDC', [W(d.hdc)]));

  if (memory) {
    const bitmap = globals(system).bitmap;

    if (bitmap) {
      const previous = await select(system, memory, bitmap);
      const kind = d.data & 0xffff;
      const source =
        kind & TRUETYPE_FONTTYPE ? 0 : (kind & PRINTER_DEVICE) === PRINTER_DEVICE ? 20 : null;

      if (source !== null) {
        const y = d.rect[1] + Math.trunc((d.rect[3] - d.rect[1] - 12) / 2);

        await call(system, 'GDI', 'BitBlt', [
          W(d.hdc),
          W(d.rect[0]),
          W(y),
          W(20),
          W(12),
          W(memory),
          W(source),
          W(d.state & 1 ? 12 : 0),
          D(SRCCOPY),
        ]);
      }

      await select(system, memory, previous);
    }

    await call(system, 'GDI', 'DeleteDC', [W(memory)]);
  }

  await restoreColours(system, d.hdc, old);
}

/** A colour's row (`20c4`): the row filled, a rectangle of the colour twice as wide as high a border in, and its name two borders right of it. */
async function drawColour(system: any, far: number) {
  const d = drawn(system, far);
  const old = await rowColours(system, d.hdc, !!(d.state & 1));

  await extTextOut(system, d.hdc, d.rect[0], d.rect[1], ETO_OPAQUE, d.rect, null);

  const cx = await metric(system, SM_CXBORDER);
  const cy = await metric(system, SM_CYBORDER);
  const top = s16(cy + d.rect[1]);
  const bottom = s16(d.rect[3] - cy);
  const left = s16(d.rect[0] + cx);
  const right = s16(left + (bottom - top) * 2);
  const brush = u16(await call(system, 'GDI', 'CreateSolidBrush', [D(d.data)]));

  if (!brush) {
    return;
  }

  const previous = await select(system, d.hdc, brush);

  await call(system, 'GDI', 'Rectangle', [W(d.hdc), W(left), W(top), W(right), W(bottom)]);
  await deleteObject(system, await select(system, d.hdc, previous));

  const value = await rowText(system, d, 0x10);

  await call(system, 'GDI', 'TextOut', [
    W(d.hdc),
    W(cx * 2 + right),
    W(d.rect[1]),
    text(value),
    W(value.length),
  ]);
  await restoreColours(system, d.hdc, old);
}

/**
 * The pictures of the faces' types (`26d9`): bitmap 38, its colour table's
 * pure blue made the window's colour and its magenta the highlight's, made a
 * bitmap for the screen and given to COMMDLG.
 */
async function makeBitmap(system: any) {
  const highlight = await sysColour(system, COLOR_HIGHLIGHT);
  const window = await sysColour(system, COLOR_WINDOW);
  const quad = (colour: number) => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, 0];
  const dib = Array.from(FONT_BITMAP);
  const header = dib[0] | (dib[1] << 8);

  for (let entry = 0; entry < 16; entry++) {
    const step = header + entry * 4;
    const rgb = dib.slice(step, step + 4).join(',');

    if (rgb === '255,0,0,0') {
      dib.splice(step, 4, ...quad(window));
    } else if (rgb === '255,0,255,0') {
      dib.splice(step, 4, ...quad(highlight));
    }
  }

  const bitsAt = header + (1 << (dib[0x0e] + 2));
  const info = dib.slice(0, bitsAt);
  const hdc = await getDc(system, 0);
  const bitmap = u16(
    await call(system, 'GDI', 'CreateDIBitmap', [
      W(hdc),
      B(info),
      D(4),
      B(dib.slice(bitsAt)),
      B(info),
      W(0),
    ])
  );

  await releaseDc(system, 0, hdc);
  await call(system, 'GDI', 'SetObjectOwner', [W(bitmap), W(instance(system))]);
  return bitmap;
}

// ---------------------------------------------------------------------
// WM_INITDIALOG (`037a`).

async function start(system: any, hwnd: number, message: number, wParam: number, lpcf: number) {
  /* The styles' names, strings 504h to 507h, are WinBox's own and always
   * there: CDERR_LOADSTRFAILURE (`03e2`) cannot happen. */
  const flags = flagsOf(system, lpcf);

  if (
    flags & CF_LIMITSIZE &&
    s16(word(system, lpcf, N_SIZE_MIN)) > s16(word(system, lpcf, N_SIZE_MAX))
  ) {
    setError(system, CFERR_MAXLESSTHANMIN);
    await call(system, 'USER', 'EndDialog', [W(hwnd), W(0)]);
    return 0;
  }

  const id = nextNumber(system);

  await call(system, 'USER', 'SetProp', [W(hwnd), D(0xa000), W(id)]);
  globals(system).hook = 0;
  globals(system).dialogs.set(id, lpcf);

  if (!globals(system).bitmap) {
    globals(system).bitmap = await makeBitmap(system);
  }

  if (!(flags & CF_APPLY)) {
    await hide(system, hwnd, PSH_APPLY);
  }

  if (!(flags & CF_EFFECTS)) {
    await hide(system, hwnd, STC_COLOR);
    await hide(system, hwnd, CMB_COLORS);
  } else {
    await listColours(system, hwnd);

    const rgb = dword(system, lpcf, RGB_COLORS);
    let index = 15;

    while (index > 0) {
      if ((await sendItem(system, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0)) >>> 0 === rgb) {
        break;
      }

      index--;
    }

    await sendItem(system, hwnd, CMB_COLORS, CB_SETCURSEL, index, 0);
  }

  await sampleRect(system, hwnd);

  /* The faces' and sizes' edit fields as high as the styles' (`025a`). */
  const height = s16(await sendItem(system, hwnd, CMB_STYLES, CB_GETITEMHEIGHT, 0xffff, 0)) >>> 0;

  await sendItem(system, hwnd, CMB_FACES, CB_SETITEMHEIGHT, 0xffff, height);
  await sendItem(system, hwnd, CMB_SIZES, CB_SETITEMHEIGHT, 0xffff, height);

  const lf = dword(system, lpcf, LP_LOGFONT);

  if (!(flags & CF_INITTOLOGFONTSTRUCT)) {
    await defaultFont(system, lf);
  }

  if (!(flags & CF_EFFECTS)) {
    await hide(system, hwnd, GRP_EFFECTS);
    await hide(system, hwnd, CHX_STRIKEOUT);
    await hide(system, hwnd, CHX_UNDERLINE);
  } else {
    await call(system, 'USER', 'CheckDlgButton', [
      W(hwnd),
      W(CHX_STRIKEOUT),
      W(byte(system, lf, LF_STRIKEOUT)),
    ]);
    await call(system, 'USER', 'CheckDlgButton', [
      W(hwnd),
      W(CHX_UNDERLINE),
      W(byte(system, lf, LF_UNDERLINE)),
    ]);
  }

  globals(system).described = 0;

  if (!(await listFaces(system, hwnd, word(system, lpcf, HDC), flags))) {
    setError(system, CFERR_NOFONTS);
    await call(system, 'USER', 'EndDialog', [W(hwnd), W(0)]);
    await removeProperty(system, hwnd, lpcf);
    return 0;
  }

  if (!(flagsOf(system, lpcf) & CF_NOFACESEL) && byte(system, lf, LF_FACENAME)) {
    await chooseExact(
      system,
      await item(system, hwnd, CMB_FACES),
      readString(system, at(lf, LF_FACENAME))
    );
    await selectionToBox(system, await item(system, hwnd, CMB_FACES));
  }

  await listStyles(system, hwnd, lpcf);

  if (!(flagsOf(system, lpcf) & CF_NOSTYLESEL)) {
    await chooseStyle(system, hwnd, lpcf, true);
  }

  if (!(flagsOf(system, lpcf) & CF_NOSIZESEL) && word(system, lf, LF_HEIGHT)) {
    const hdc = await getDc(system, 0);
    const [, value] = await points(system, hdc, word(system, lf, LF_HEIGHT));

    await releaseDc(system, 0, hdc);
    await chooseExact(system, await item(system, hwnd, CMB_SIZES), value);
    await call(system, 'USER', 'SetDlgItemText', [W(hwnd), W(CMB_SIZES), text(value)]);
  }

  if (!(flagsOf(system, lpcf) & CF_SHOWHELP)) {
    const help = await item(system, hwnd, PSH_HELP);

    await call(system, 'USER', 'ShowWindow', [W(help), W(0)]);
    await call(system, 'USER', 'EnableWindow', [W(help), W(0)]);
  }

  await sendItem(system, hwnd, CMB_FACES, CB_LIMITTEXT, 0x1f, 0);
  await sendItem(system, hwnd, CMB_STYLES, CB_LIMITTEXT, 0x1f, 0);
  await sendItem(system, hwnd, CMB_SIZES, CB_LIMITTEXT, 4, 0);

  if (flagsOf(system, lpcf) & CF_ENABLEHOOK) {
    return callHook(system, dword(system, lpcf, HOOK), hwnd, message, wParam, lpcf);
  }

  const cursor = u16(await call(system, 'USER', 'LoadCursor', [W(0), D(IDC_ARROW)]));

  await call(system, 'USER', 'SetCursor', [W(cursor)]);
  return 1;
}

/** The sixteen colours listed, each named by its string and with its `COLORREF` as its data (`1db7`). */
async function listColours(system: any, hwnd: number) {
  for (let index = 0; index < FONT_COLOURS.length; index++) {
    const placed = s16(
      await sendItemBytes(system, hwnd, CMB_COLORS, CB_INSERTSTRING, index, [
        ...string(0x410 + index, COLOUR_NAME_SIZE),
        0,
      ])
    );

    if (placed >= 0) {
      await sendItem(system, hwnd, CMB_COLORS, CB_SETITEMDATA, placed, FONT_COLOURS[index]);
    }
  }
}

/** The sample's rectangle, 444h's in the dialog's client coordinates (`1e2d`). */
async function sampleRect(system: any, hwnd: number) {
  const control = await item(system, hwnd, STC_SAMPLE);
  const rect = rectOf(
    (await api(system, 'USER', 'GetWindowRect', [W(control), B(rectBytes([0, 0, 0, 0]))]))
      .buffers[0]
  );

  for (const corner of [0, 1]) {
    const point = rectOf(
      (
        await api(system, 'USER', 'ScreenToClient', [
          W(hwnd),
          B(rectBytes([rect[corner * 2], rect[corner * 2 + 1], 0, 0])),
        ])
      ).buffers[0]
    );

    rect[corner * 2] = point[0];
    rect[corner * 2 + 1] = point[1];
  }

  globals(system).sample = rect;
}

// ---------------------------------------------------------------------
// The size typed (`0a78`), the LOGFONT (`241e`) and the sample (`226b`).

/**
 * The size typed (`0a78`). `fallback` makes an empty box ten points; `check`
 * puts up a box for one not a number or outside `CF_LIMITSIZE`'s limits,
 * answering null. Without `fallback`, an empty box answers null; without
 * `check`, text not a number answers nought.
 */
async function sizeTyped(
  system: any,
  hwnd: number,
  lpcf: number,
  fallback: boolean,
  check: boolean
): Promise<number | null> {
  const [length] = await intoBuffer(system, 'USER', 'GetDlgItemText', [
    W(hwnd),
    W(CMB_SIZES),
    buffer(0x5a),
    W(0x5a),
  ]);
  let size: number;
  let good: boolean;

  if (u16(length)) {
    const called = await api(system, 'USER', 'GetDlgItemInt', [
      W(hwnd),
      W(CMB_SIZES),
      buffer(2),
      W(1),
    ]);

    good = called.buffers[0][0] !== 0 || called.buffers[0][1] !== 0;
    size = good ? s16(called.value) : 0;
  } else if (fallback) {
    size = 10;
    good = true;
  } else {
    return null;
  }

  if (!check) {
    return size;
  }

  let message: number[] = [];

  if (flagsOf(system, lpcf) & CF_LIMITSIZE) {
    const min = s16(word(system, lpcf, N_SIZE_MIN));
    const max = s16(word(system, lpcf, N_SIZE_MAX));

    if (!good || max < size || min > size) {
      good = false;
      message = format(string(0x44b, 0x5a), [min, max]);
    }
  } else if (!good) {
    message = string(0x44a, 0x5a);
  }

  if (good) {
    return size;
  }

  const [, caption] = await intoBuffer(system, 'USER', 'GetWindowText', [
    W(hwnd),
    buffer(0x5a),
    W(0x5a),
  ]);

  await messageBox(system, hwnd, message, caption);
  return null;
}

async function messageBox(system: any, hwnd: number, value: number[], caption: number[]) {
  await call(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(value),
    text(caption),
    W(MB_ICONINFORMATION),
  ]);
}

/**
 * The `LOGFONT` as the dialog stands written to `lf` (`241e`), and with
 * `update` the program's `CF_NOFACESEL`, `CF_NOSTYLESEL` and `CF_NOSIZESEL`
 * set and cleared; with `CF_PRINTERFONTS`, the font's description given
 * where the style's type changed. Whether face, style and size are all
 * chosen.
 */
async function logfont(system: any, hwnd: number, lpcf: number, lf: number, update: boolean) {
  const value = bytes(system, lf, 0, LOGFONT_SIZE);
  const chosen = await logfontBytes(system, hwnd, lpcf, value, update);

  put(system, lf, 0, value);
  return chosen;
}

/** `logfont` on bytes of WinBox's, those of the `LOGFONT` it is given as they were: what each step writes written over them. */
async function logfontBytes(
  system: any,
  hwnd: number,
  lpcf: number,
  lf: number[],
  update: boolean
) {
  let chosen = 1;

  await defaultLogfontBytes(system, lf);

  const [, face] = await intoBuffer(system, 'USER', 'GetDlgItemText', [
    W(hwnd),
    W(CMB_FACES),
    buffer(0x20),
    W(0x20),
  ]);

  lf.splice(LF_FACENAME, face.length + 1, ...face, 0);

  const listed = (await findExact(system, await item(system, hwnd, CMB_FACES), face)) >= 0;

  if (!listed) {
    chosen = 0;
  }

  if (update) {
    setFlag(system, lpcf, CF_NOFACESEL, !listed);
  }

  const [, index, data] = await boxRow(system, await item(system, hwnd, CMB_STYLES), 0x20);
  let kind = 0;

  if (index >= 0) {
    const style = styleFont(system, data & 0xffff);

    lf.splice(0, LOGFONT_SIZE, ...style);
    lf[2] = 0;
    lf[3] = 0;

    if (update) {
      setFlag(system, lpcf, CF_NOSTYLESEL, false);
    }

    kind = data >>> 16;
  } else {
    chosen = 0;

    if (update) {
      setFlag(system, lpcf, CF_NOSTYLESEL, true);
    }
  }

  const size = (await sizeTyped(system, hwnd, lpcf, false, false)) ?? 0;
  const hdc = await getDc(system, 0);

  if (size) {
    const pixels = await deviceCaps(system, hdc, LOGPIXELSY);

    setLfWord(lf, LF_HEIGHT, -(await mulDiv(system, size, pixels, 72)));

    if (update) {
      setFlag(system, lpcf, CF_NOSIZESEL, false);
    }
  } else {
    const pixels = await deviceCaps(system, hdc, LOGPIXELSY);

    setLfWord(lf, LF_HEIGHT, -(await mulDiv(system, 10, pixels, 72)));
    chosen = 0;

    if (update) {
      setFlag(system, lpcf, CF_NOSIZESEL, true);
    }
  }

  await releaseDc(system, 0, hdc);
  lf[LF_STRIKEOUT] =
    (await call(system, 'USER', 'IsDlgButtonChecked', [W(hwnd), W(CHX_STRIKEOUT)])) & 0xff;
  lf[LF_UNDERLINE] =
    (await call(system, 'USER', 'IsDlgButtonChecked', [W(hwnd), W(CHX_UNDERLINE)])) & 0xff;

  const described = globals(system).described;

  if (kind !== described && flagsOf(system, lpcf) & CF_PRINTERFONTS) {
    const id =
      kind & SIMULATED_FONTTYPE
        ? 0x44c
        : kind & TRUETYPE_FONTTYPE
          ? 0x44d
          : (kind & (SCREEN_FONTTYPE | PRINTER_FONTTYPE)) === SCREEN_FONTTYPE
            ? 0x44f
            : (kind & PRINTER_DEVICE) === PRINTER_DEVICE
              ? 0x44e
              : 0;

    await call(system, 'USER', 'SetDlgItemText', [
      W(hwnd),
      W(STC_DESCRIPTION),
      text(id ? string(id, 0x80) : []),
    ]);
  }

  globals(system).described = kind;
  return chosen;
}

/**
 * The sample drawn (`226b`): the font as the dialog stands, in the colour
 * chosen, centred across where it fits, its baseline placing the ascent less
 * the internal leading centred down, never below the bottom.
 */
async function paintSample(system: any, hwnd: number, lpcf: number, hdc: number) {
  /* The LOGFONT made on COMMDLG's stack (`[bp-58h]`); what its stack held
   * there before is not known, and WinBox starts from noughts. */
  const lf = new Array(LOGFONT_SIZE).fill(0);
  const complete = await logfontBytes(system, hwnd, lpcf, lf, false);
  const font = u16(await call(system, 'GDI', 'CreateFontIndirect', [B(lf)]));

  if (!font) {
    return;
  }

  const oldFont = await select(system, hdc, font);
  const oldBack = await setBkColour(system, hdc, await sysColour(system, COLOR_WINDOW));
  let colour: number | null = null;

  if (flagsOf(system, lpcf) & CF_EFFECTS) {
    const index = u16(await sendItem(system, hwnd, CMB_COLORS, CB_GETCURSEL, 0, 0));

    if (index !== 0xffff) {
      colour = (await sendItem(system, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0)) >>> 0;
    }
  }

  const oldFore = await setTextColour(
    system,
    hdc,
    colour ?? (await sysColour(system, COLOR_WINDOWTEXT))
  );
  const value = complete
    ? (
        await intoBuffer(system, 'USER', 'GetDlgItemText', [
          W(hwnd),
          W(STC_SAMPLE),
          buffer(0x32),
          W(0x32),
        ])
      )[1]
    : [];
  const tm = await textMetrics(system, hdc);
  const extent = s16(
    await call(system, 'GDI', 'GetTextExtent', [W(hdc), text(value), W(value.length)])
  );
  const ascent = s16(lfWord(tm, 2));
  const above = s16(ascent - s16(lfWord(tm, 6)));
  const rect = globals(system).sample;
  const x =
    s16(rect[2] - rect[0]) > extent && extent > 0
      ? Math.trunc(s16(rect[2] - extent - rect[0]) / 2) + rect[0]
      : rect[0];
  const baseline = Math.min(Math.trunc(s16(above - rect[3] + rect[1]) / 2) + rect[3], rect[3]);

  await extTextOut(system, hdc, x, s16(baseline - ascent), ETO_OPAQUE | ETO_CLIPPED, rect, value);
  await setBkColour(system, hdc, oldBack);
  await setTextColour(system, hdc, oldFore);

  if (oldFont) {
    await deleteObject(system, await select(system, hdc, oldFont));
  }
}

/** The sample painted again: its rectangle invalidated, not erased, and the dialog updated (`0eb3`). */
async function repaint(system: any, hwnd: number) {
  await call(system, 'USER', 'InvalidateRect', [
    W(hwnd),
    B(rectBytes(globals(system).sample)),
    W(0),
  ]);
  await call(system, 'USER', 'UpdateWindow', [W(hwnd)]);
}

// ---------------------------------------------------------------------
// WM_COMMAND (`0b9d`).

async function command(
  system: any,
  hwnd: number,
  lpcf: number,
  id: number,
  code: number,
  control: number
) {
  const post = () =>
    call(system, 'USER', 'PostMessage', [
      W(hwnd),
      W(WM_COMMAND),
      W(id),
      D(((TYPED << 16) | control) >>> 0),
    ]);
  const typed = async () => {
    const [, value] = await intoBuffer(system, 'USER', 'GetWindowText', [
      W(control),
      buffer(0x20),
      W(0x20),
    ]);
    const index = await findExact(system, control, value);

    if (index < 0) {
      return false;
    }

    await send(system, control, CB_SETCURSEL, index, 0);
    await send(system, control, CB_SETEDITSEL, 0, 0xffffffff);
    return true;
  };

  switch (id) {
    case IDOK:
      await ok(system, hwnd, lpcf);
      break;

    case IDCANCEL:
      await freeStyles(system, await item(system, hwnd, CMB_STYLES));
      await end(system, hwnd, lpcf, 0);
      break;

    case IDABORT:
      await freeStyles(system, await item(system, hwnd, CMB_STYLES));
      await end(system, hwnd, lpcf, control);
      break;

    case PSH_HELP: {
      const help = registered(system, 'commdlg_help');
      const owner = word(system, lpcf, HWND_OWNER);

      if (help && owner) {
        await call(system, 'USER', 'SendMessage', [W(owner), W(help), W(hwnd), D(lpcf)]);
      }

      break;
    }

    case CHX_STRIKEOUT:
    case CHX_UNDERLINE:
      await repaint(system, hwnd);
      break;

    case CMB_FACES:
      if (code === CBN_SELCHANGE) {
        await selectionToBox(system, control);
        await faceChanged(system, hwnd, lpcf);
      } else if (code === CBN_EDITUPDATE) {
        await post();
      } else if (code === TYPED && (await typed())) {
        await faceChanged(system, hwnd, lpcf);
      }

      break;

    case CMB_STYLES:
    case CMB_SIZES:
      if (code === CBN_SELCHANGE) {
        const index = await selectionToBox(system, control);

        if (index >= 0 && id === CMB_STYLES) {
          const style = styleFont(
            system,
            u16(await send(system, control, CB_GETITEMDATA, index, 0))
          );
          const lf = dword(system, lpcf, LP_LOGFONT);

          putWord(system, lf, LF_WEIGHT, lfWord(style, LF_WEIGHT));
          put(system, lf, LF_ITALIC, [style[LF_ITALIC]]);
        }

        await repaint(system, hwnd);
      } else if (code === CBN_KILLFOCUS) {
        await repaint(system, hwnd);
      } else if (code === CBN_EDITUPDATE) {
        await post();
      } else if (code === TYPED && id === CMB_STYLES && (await typed())) {
        await repaint(system, hwnd);
      }

      break;

    case CMB_COLORS:
      if (code === CBN_SELCHANGE) {
        await repaint(system, hwnd);
      }

      break;

    default:
      return 0;
  }

  return 1;
}

/**
 * A face chosen (`0dfe`): the size typed kept, the styles and sizes listed
 * again, the nearest style chosen, the size chosen where it is listed and
 * typed back where not, and the sample painted.
 */
async function faceChanged(system: any, hwnd: number, lpcf: number) {
  const [, typed] = await intoBuffer(system, 'USER', 'GetDlgItemText', [
    W(hwnd),
    W(CMB_SIZES),
    buffer(0x0a),
    W(0x0a),
  ]);

  await listStyles(system, hwnd, lpcf);
  await chooseStyle(system, hwnd, lpcf, false);

  const index = await findExact(system, await item(system, hwnd, CMB_SIZES), typed);

  if (index < 0) {
    await call(system, 'USER', 'SetDlgItemText', [W(hwnd), W(CMB_SIZES), text(typed)]);
  } else {
    await sendItem(system, hwnd, CMB_SIZES, CB_SETCURSEL, index, 0);
  }

  await repaint(system, hwnd);
}

/** The dialog ended (`0bfc`). */
async function end(system: any, hwnd: number, lpcf: number, result: number) {
  await call(system, 'USER', 'EndDialog', [W(hwnd), W(result)]);
  await removeProperty(system, hwnd, lpcf);
}

/** The dialog's property removed, its data let go, and the hook kept in COMMDLG's data again (`0c07`, `05b4`). */
async function removeProperty(system: any, hwnd: number, lpcf: number) {
  const id = u16(await call(system, 'USER', 'RemoveProp', [W(hwnd), D(0xa000)]));

  globals(system).dialogs.delete(id);

  if (flagsOf(system, lpcf) & CF_ENABLEHOOK) {
    globals(system).hook = dword(system, lpcf, HOOK);
  }
}

/** OK (`0c35`). */
async function ok(system: any, hwnd: number, lpcf: number) {
  const next = async (id: number) => {
    const control = await item(system, hwnd, id);

    await call(system, 'USER', 'PostMessage', [W(hwnd), W(WM_NEXTDLGCTL), W(control), D(1)]);
  };
  const size = await sizeTyped(system, hwnd, lpcf, true, true);

  if (size === null) {
    await next(CMB_SIZES);
    return;
  }

  putWord(system, lpcf, I_POINT_SIZE, size * 10);
  await logfont(system, hwnd, lpcf, dword(system, lpcf, LP_LOGFONT), true);

  const flags = flagsOf(system, lpcf);

  if (flags & CF_FORCEFONTEXIST) {
    const wrong =
      flags & CF_NOFACESEL
        ? [CMB_FACES, 0x502]
        : flags & CF_NOSTYLESEL
          ? [CMB_STYLES, 0x503]
          : null;

    if (wrong) {
      const [, caption] = await intoBuffer(system, 'USER', 'GetWindowText', [
        W(hwnd),
        buffer(0xa0),
        W(0xa0),
      ]);

      await messageBox(system, hwnd, string(wrong[1], 0xa0), caption);
      await next(wrong[0]);
      return;
    }
  }

  if (flags & CF_EFFECTS) {
    const index = u16(await sendItem(system, hwnd, CMB_COLORS, CB_GETCURSEL, 0, 0));

    putDword(
      system,
      lpcf,
      RGB_COLORS,
      (await sendItem(system, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0)) >>> 0
    );
  }

  const [name, , data] = await boxRow(system, await item(system, hwnd, CMB_STYLES), 0x20);

  /* Where the style is not listed COMMDLG writes a word of its stack it
   * never set (`0d90`); WinBox writes nought. */
  putWord(system, lpcf, N_FONT_TYPE, data >>> 16);

  if (flags & CF_USESTYLE) {
    put(system, dword(system, lpcf, LPSZ_STYLE), 0, [...name, 0]);
  }

  await freeStyles(system, await item(system, hwnd, CMB_STYLES));
  await end(system, hwnd, lpcf, 1);
}
