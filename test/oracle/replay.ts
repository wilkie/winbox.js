'use strict';

import { GlobalCompact, LocalHandleDelta } from '../../src/win16/kernel/memory-info.js';
import { GetFreeSpace } from '../../src/win16/kernel/GetFreeSpace.js';
import { GetSystemDirectory, GetWindowsDirectory } from '../../src/win16/kernel/GetWindowsDirectory.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { GetWinFlags } from '../../src/win16/kernel/GetWinFlags.js';
import { exportedConstant } from '../../src/win16/linker.js';
import { PROBES, imageFor, outputOf, recordsFrom, runProbe } from '../win16/run-probe.js';
import { File } from '../../src/file-system.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Machine } from '../../src/emulator/machine.js';
import { FontManager } from '../../src/win16/font-manager.js';
import { HandleManager } from '../../src/win16/handle-manager.js';
import { Surface } from '../../src/raster/surface.js';
import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { rasterDesktop } from '../../src/win16/user/raster-desktop.js';
import {
  NoDrive,
  chromeCapture,
  driverOf,
  iconsCapture,
  dialogPlace,
  dialogsCapture,
  dlgColorCapture,
  editCapture,
  comboboxCapture,
  listboxCapture,
  noscrollCapture,
  sbtrackCapture,
  enumfamCapture,
  registryCapture,
  lberrCapture,
  netcapsCapture,
  drivetypCapture,
  drawtextCapture,
  groupboxCapture,
  mlEditCapture,
  menusCapture,
  quitOrder,
  activateCapture,
  atomsCapture,
  selinfoCapture,
  mmdevsCapture,
  handbitsCapture,
  msgboxCapture,
  stretchCapture,
  patbrushCapture,
  clipdcCapture,
  mapmodeCapture,
  showsbCapture,
  minisCapture,
  hooksCapture,
  mdiscrlCapture,
  clipCapture,
  editclipCapture,
  justifyCapture,
  paletteCapture,
  miscCapture,
  enumobjCapture,
  accresCapture,
  spooljobCapture,
  sizingCapture,
} from './replay-windows.js';
import { RegisterWindowMessage } from '../../src/win16/user/RegisterWindowMessage.js';
import { LoadString } from '../../src/win16/user/LoadString.js';
import { WinHelp } from '../../src/win16/user/WinHelp.js';
import {
  EqualRect,
  InflateRect,
  IntersectRect,
  IsRectEmpty,
  OffsetRect,
  SubtractRect,
  UnionRect,
} from '../../src/win16/user/rect-api.js';
import { resourcesOf } from '../../src/win16/ne-resources.js';
import { SystemParametersInfo } from '../../src/win16/user/SystemParametersInfo.js';
import { Brush } from '../../src/raster/brush.js';
import { Pen } from '../../src/raster/pen.js';
import { Color } from '../../src/raster/color.js';
import { GetStockObject } from '../../src/win16/gdi/GetStockObject.js';
import { SelectObject } from '../../src/win16/gdi/SelectObject.js';
import { GetGlyphOutline } from '../../src/win16/gdi/GetGlyphOutline.js';
import { scalableFontResource } from '../../src/win16/gdi/CreateScalableFontResource.js';
import { GetTextExtent } from '../../src/win16/gdi/GetTextExtent.js';
import { GetTextFace } from '../../src/win16/gdi/GetTextFace.js';
import { GetTextMetrics } from '../../src/win16/gdi/GetTextMetrics.js';
import { GetCharWidth } from '../../src/win16/gdi/GetCharWidth.js';
import { GetDeviceCaps } from '../../src/win16/gdi/GetDeviceCaps.js';
import { GetSystemMetrics } from '../../src/win16/user/GetSystemMetrics.js';
import { GetSysColor } from '../../src/win16/user/GetSysColor.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { Gdi } from '../../src/win16/gdi.js';
import { User } from '../../src/win16/user.js';
import { GlobalAllocator } from '../../src/win16/global-allocator.js';
import { Allocator } from '../../src/win16/allocator.js';

import { lstrlen } from '../../src/win16/kernel/lstrlen.js';
import { CreateFontIndirect } from '../../src/win16/gdi/CreateFontIndirect.js';
import { GetPrivateProfileInt } from '../../src/win16/kernel/GetPrivateProfileInt.js';
import { GetPrivateProfileString } from '../../src/win16/kernel/GetPrivateProfileString.js';
import { LineTo } from '../../src/win16/gdi/LineTo.js';
import { MoveTo } from '../../src/win16/gdi/MoveTo.js';
import { Polygon } from '../../src/win16/gdi/Polygon.js';
import { Ellipse } from '../../src/win16/gdi/Ellipse.js';
import { RoundRect } from '../../src/win16/gdi/RoundRect.js';
import { CreatePen } from '../../src/win16/gdi/CreatePen.js';
import { GetROP2, SetROP2 } from '../../src/win16/gdi/SetROP2.js';
import { TextOut } from '../../src/win16/gdi/TextOut.js';
import { CreateCompatibleBitmap } from '../../src/win16/gdi/CreateCompatibleBitmap.js';
import { GetPixel } from '../../src/win16/gdi/GetPixel.js';
import { GetNearestColor } from '../../src/win16/gdi/GetNearestColor.js';
import { BitBlt } from '../../src/win16/gdi/BitBlt.js';
import { SetPixel } from '../../src/win16/gdi/SetPixel.js';
import { CreateSolidBrush } from '../../src/win16/gdi/CreateSolidBrush.js';
import { CreateCompatibleDC } from '../../src/win16/gdi/CreateCompatibleDC.js';
import { Escape } from '../../src/win16/gdi/Escape.js';
import { GetBitmapBits } from '../../src/win16/gdi/GetBitmapBits.js';
import { PatBlt } from '../../src/win16/gdi/PatBlt.js';
import { CreateBitmap } from '../../src/win16/gdi/CreateBitmap.js';
import { ExtTextOut } from '../../src/win16/gdi/ExtTextOut.js';
import { SetTextCharacterExtra } from '../../src/win16/gdi/SetTextCharacterExtra.js';
import { SetTextAlign } from '../../src/win16/gdi/SetTextAlign.js';
import { SetBkMode } from '../../src/win16/gdi/SetBkMode.js';
import { SetBkColor } from '../../src/win16/gdi/SetBkColor.js';
import { SetTextColor } from '../../src/win16/gdi/SetTextColor.js';
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
import { LocalFree } from '../../src/win16/kernel/LocalFree.js';
import { LocalReAlloc } from '../../src/win16/kernel/LocalReAlloc.js';
import { LocalUnlock } from '../../src/win16/kernel/LocalUnlock.js';
import { LocalLock } from '../../src/win16/kernel/LocalLock.js';
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
  '[Spacing]',
  'after=   after only',
  'before   =before only',
  'around   =   around both',
  'tabbed=\tafter a tab',
  'ends=  both ends  ',
  '',
  '[Odd]   ',
  '  indented  =  in  ',
  'bare line  ',
  'one=x ',
  '',
].join('\r\n');

/**
 * What the profile probe does to its file, in order: each write, the flush,
 * each read of `WIN.INI`, and the points it recorded the file's bytes at or
 * read a value back. A record that depends on the state of the file -- the
 * bytes after a write, a value read again after the flush -- is replayed by
 * running this up to its point. Mirrors `profile.c` as `SUBJECT_PROFILE` does.
 */
type ProfileStep =
  ['write', string, string, string | null] | ['flush'] | ['windows'] | ['at', string];

const PROFILE_SCRIPT: ProfileStep[] = [
  ['at', 'before any write'],
  ['write', 'Plain', 'added', 'new value'],
  ['at', 'after added'],
  ['write', 'Plain', 'entry', 'replaced'],
  ['at', 'after entry'],
  ['write', 'Fresh', 'first', 'in a new section'],
  ['at', 'after first'],
  ['write', 'Plain', 'added', null],
  ['at', 'after added removed'],
  ['write', 'Plain', 'spaced', '  untrimmed  '],
  ['at', 'after spaced'],
  ['write', 'Plain', 'both', '  both ends  '],
  ['write', 'Plain', 'trailing', 'trailing only   '],
  ['write', 'Plain', 'leading', '   leading only'],
  ['write', 'Plain', 'blank', '   '],
  ['write', 'Plain', 'tabbed', 'tab\t'],
  ['at', 'after the in-place writes'],
  ['windows'],
  ['flush'],
  ['at', 'after flush'],
  ['write', 'Plain', 'again', '  again  '],
  ['at', 'after writing again'],
  ['windows'],
  ['at', 'after reading WIN.INI'],
  ['write', 'Plain', 'ENTRY', 'recased'],
  ['at', 'at the end'],
];

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
  /* In GDI's own order, whatever order `SYSTEM.INI` writes them in: see
   * `fontDirectoryOrder`. */
  const lines = section(systemProfile, 'boot');
  const boot = ['fonts.fon', 'fixedfon.fon', 'oemfonts.fon'].flatMap((font) =>
    lines.filter(([key]) => key.toLowerCase() === font)
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
  /* The VGA with a printer has the VGA's fonts. Its own drive is not read:
   * reading it would put its WIN.INI, a printer in it, in place of the
   * VGA's for every probe after. */
  if (display === 'vgaprint') {
    display = 'vga';
  }

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
  const ink = (column: number, row: number) =>
    !(bytes[row * stride + (column >> 3)] & (0x80 >> (column & 7)));
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
/**
 * `curves`'s shapes, as `oracle/probes/curves.c` lists them: the kind (0
 * `Ellipse`, 1 `RoundRect`), the rectangle, the corner, the pen's width (0
 * for none) and whether the light grey brush is selected.
 */
const CURVES: number[][] = [
  [0, 4, 4, 5, 5, 0, 0, 1, 1],
  [0, 10, 4, 12, 6, 0, 0, 1, 1],
  [0, 16, 4, 19, 7, 0, 0, 1, 1],
  [0, 24, 4, 28, 8, 0, 0, 1, 1],
  [0, 32, 4, 37, 9, 0, 0, 1, 1],
  [0, 42, 4, 48, 10, 0, 0, 1, 1],
  [0, 52, 4, 59, 11, 0, 0, 1, 1],
  [0, 64, 4, 72, 12, 0, 0, 1, 1],
  [0, 4, 16, 44, 40, 0, 0, 1, 1],
  [0, 50, 16, 77, 49, 0, 0, 1, 1],
  [0, 84, 16, 114, 36, 0, 0, 0, 1],
  [0, 120, 16, 150, 40, 0, 0, 3, 1],
  [0, 156, 16, 186, 40, 0, 0, 1, 0],
  [0, 192, 16, 228, 18, 0, 0, 1, 1],
  [1, 4, 56, 40, 76, 8, 8, 1, 1],
  [1, 46, 56, 86, 80, 12, 6, 1, 1],
  [1, 92, 56, 122, 86, 30, 30, 1, 1],
  [1, 128, 56, 168, 74, 4, 4, 1, 1],
  [1, 174, 56, 214, 86, 0, 0, 1, 1],
  [1, 4, 92, 44, 122, 7, 9, 1, 1],
  [1, 50, 92, 80, 112, 10, 10, 0, 1],
  [1, 86, 92, 106, 102, 40, 40, 1, 1],
  [1, 112, 92, 152, 122, 16, 16, 3, 1],
  [1, 158, 92, 198, 122, 16, 16, 1, 0],
  [1, 204, 92, 236, 110, 5, 5, 1, 1],
];

const screenCaptures = new Map<string, string[]>();

/** The control probes' records: `editctl`'s, `mledit`'s or `listbox`'s. */
function editRecords(context: any) {
  if (context.probe === 'listbox') {
    return listboxCapture(context);
  }

  if (context.probe === 'combobox') {
    return comboboxCapture(context);
  }

  if (context.probe === 'noscroll') {
    return noscrollCapture(context);
  }

  if (context.probe === 'sbtrack') {
    return sbtrackCapture(context);
  }

  if (context.probe === 'enumfam') {
    return enumfamCapture(context);
  }

  if (context.probe === 'registry') {
    return registryCapture(context);
  }

  if (context.probe === 'lberr') {
    return lberrCapture(context);
  }

  if (context.probe === 'netcaps') {
    return netcapsCapture(context);
  }

  if (context.probe === 'drivetyp') {
    return drivetypCapture(context);
  }

  if (context.probe === 'drawtext') {
    return drawtextCapture(context);
  }

  if (context.probe === 'activate') {
    return activateCapture(context);
  }

  if (context.probe === 'atoms') {
    return atomsCapture(context);
  }

  if (context.probe === 'selinfo') {
    return selinfoCapture(context);
  }

  if (context.probe === 'mmdevs') {
    return mmdevsCapture(context);
  }

  if (context.probe === 'msgbox') {
    return msgboxCapture(context);
  }

  if (context.probe === 'stretch') {
    return stretchCapture(context);
  }

  if (context.probe === 'patbrush') {
    return patbrushCapture(context);
  }

  if (context.probe === 'clipdc') {
    return clipdcCapture(context);
  }

  if (context.probe === 'mapmode') {
    return mapmodeCapture(context);
  }

  if (context.probe === 'showsb') {
    return showsbCapture(context);
  }

  if (context.probe === 'minis') {
    return minisCapture(context);
  }

  if (context.probe === 'hooks') {
    return hooksCapture(context);
  }

  if (context.probe === 'mdiscrl') {
    return mdiscrlCapture(context);
  }

  if (context.probe === 'clip') {
    return clipCapture(context);
  }

  if (context.probe === 'editclip') {
    return editclipCapture(context);
  }

  if (context.probe === 'palette') {
    return paletteCapture(context);
  }

  if (context.probe === 'misc') {
    return miscCapture(context);
  }

  if (context.probe === 'enumobj') {
    return enumobjCapture(context);
  }

  if (context.probe === 'accres') {
    return accresCapture(context);
  }

  if (context.probe === 'spooljob') {
    return spooljobCapture(context);
  }

  return context.probe === 'mledit' ? mlEditCapture(context) : editCapture(context);
}
const mixmodeModes = new Map<string, string[]>();

/** A file of bytes the harness holds, read as the kernel's calls read a file on a drive. */
class BinaryFile extends File {
  declare bytes: Uint8Array;

  constructor(name: string, bytes: Uint8Array) {
    super({ name, size: bytes.byteLength });
    this.bytes = bytes;
  }

  async read(offset: number, length: number) {
    return this.bytes.slice(offset, offset + length).buffer;
  }

  async read8(offset: number) {
    return this.bytes[offset];
  }
}

export class NeedsDrive extends Error {}

/** An `accres` record, which needs the probe's program as the oracle built it. */
async function accresRecord(context: any, kind: string, args: (string | number)[]) {
  if (context.probe !== 'accres') {
    throw new NoAdapter();
  }

  const records = await editRecords(context);

  if (!records.size) {
    throw new NeedsDrive('the probe is read from its own program; run the oracle pipeline');
  }

  return records.get(`${kind}:${args.join(',')}`) ?? '';
}


/** An adapter's name a probe uses for a record the adapter does not replay: no adapter for it. */
export class NoAdapter extends Error {}

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
  /** The fixture's file name without `.json`, which is unique where probe and display may not be. */
  file: string;
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
  displayName: string;

  /** The probe whose record is being replayed, for adapters several probes share. */
  probe = '';
  private next: number;
  private _dos: any = null;
  private _screen: any = null;
  private _rasterDesktop: any = null;

  /**
   * What stands in for the scheduler: the window procedures a replay gives
   * its classes are functions here, and are called directly. See
   * `replay-windows.ts`.
   */
  scheduler = {
    active: 0,

    /* The tasks by handle: the one program's, as `GetNumTasks` counts them. */
    get _tasks() {
      return { [this.active]: this.task };
    },

    /* The one program's queue: what is posted to it, taken in order, never
     * waited for -- a replay has nothing to wait on. */
    task: {
      messages: [] as any[],
      push(message: any) {
        this.messages.push(message);
      },
      peek() {
        return this.messages[0] ?? null;
      },
      async pull() {
        return this.messages.shift() ?? null;
      },
      /* Everything here was posted: there is no input. */
      findIn(input: boolean, match: (message: any) => boolean, remove: boolean) {
        const at = input ? -1 : this.messages.findIndex(match);

        if (at < 0) {
          return null;
        }

        return remove ? this.messages.splice(at, 1)[0] : this.messages[at];
      },
    },
    callWndProc: async (
      windowClass: any,
      hwnd: number,
      message: number,
      wParam: number,
      lParam: number
    ) =>
      typeof windowClass?.lpfnWndProc === 'function'
        ? windowClass.lpfnWndProc(hwnd, message, wParam, lParam)
        : 0,

    /* A procedure called directly: a dialog's, which the replay gives as a function. */
    callWindowProc: async (
      proc: any,
      hwnd: number,
      message: number,
      wParam: number,
      lParam: number
    ) => (typeof proc === 'function' ? proc(hwnd, message, wParam, lParam) : 0),
  };

  /** And for the window manager: there is no input to route. */
  windows = { register: () => {} };

  /** Time does not pass in a replay: on its clock every timer is due when asked. See `queue.ts`. */
  virtualClock = true;

  constructor(display = 'vga') {
    this.machine = new Machine();
    this.next = 0x100;

    /* Which driver we are answering as. A capability fixture is meaningless
     * without it, so the fixture names its display and the context adopts it.
     */
    this.display = displayMode(display);
    this.displayName = display;

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

  /** The screen, the display's size, as `Win16` keeps it. */
  get screen() {
    if (!this._screen) {
      this._screen = Surface.memory();
      this._screen.bitmap = new DeviceBitmap(
        this.display.width,
        this.display.height,
        DevicePalette.depthOf(this.display),
        undefined,
        DevicePalette.forDisplay(this.display)
      );
    }

    return this._screen;
  }

  /**
   * USER's raster desktop on that screen, with the display driver's own OEM
   * bitmaps from the oracle's installation of the display.
   */
  get rasterDesktop() {
    if (!this._rasterDesktop) {
      try {
        this._rasterDesktop = rasterDesktop(this, driverOf(this.displayName));
      } catch (error) {
        if (error instanceof NoDrive) {
          throw new NeedsDrive(error.message);
        }

        throw error;
      }
    }

    return this._rasterDesktop;
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
      LocalInit.call(this, this.machine.cpu.core.ds, 16, size);
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

    /* And the registration database the installation has, which the
     * `registry` probe reads and changes (a copy, here). */
    const registry = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS', 'REG.DAT');

    if (existsSync(registry)) {
      contents.set('reg.dat', readFileSync(registry).toString('latin1'));
    }

    /* And the probe's own program, as the oracle built it, for the calls that
     * read a module's file: a file as the kernel's calls expect one. */
    const binaries = new Map<string, Uint8Array>();
    const program = join(__dirname, '..', '..', 'oracle', 'build', 'probes', `${this.probe.toUpperCase()}.EXE`);

    if (this.probe && existsSync(program)) {
      binaries.set(`${this.probe.toLowerCase()}.exe`, new Uint8Array(readFileSync(program)));
    }

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

          if (binaries.has(key)) {
            const handle = nextHandle++;
            open.set(handle, new BinaryFile(key, binaries.get(key)!));

            return handle;
          }

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
        /* Made again empty, as DOS makes a file. */
        create(path: string) {
          const key = String(path).split(/[\\/]/).pop()!.toLowerCase();

          contents.set(key, '');

          const handle = nextHandle++;
          open.set(handle, fileFor(key));

          return handle;
        },
        systemRootPath: 'C:\\WINDOWS\\',
        /* The drives DOSBox gives the oracle's Windows: a floppy A:, the
         * installation's C:, and its own Z:. */
        query(letter: string) {
          return ({ A: { removable: true }, C: {}, Z: {} } as Record<string, any>)[letter] ?? null;
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
    return this.drawPath([
      [fromX, fromY],
      [fromX + dx, fromY + dy],
    ]);
  }

  drawGlyph(font: any, character: string, cell = 32, ground: any = {}) {
    const surface: any = this.memoryCell(cell, cell);

    surface.font = font;

    /* What the probe told the device context about the ground behind the text,
     * through the calls it made. Only `textbk` sets the colour or the mode;
     * everything else leaves a fresh context's white and `OPAQUE`, which is
     * what these default to. */
    const hdc = this.handles.allocate(surface);

    if (ground.back) {
      SetBkColor.call(this, hdc, 0x000000);
    }

    SetBkMode.call(this, hdc, ground.opaque === 0 ? 1 : 2);
    SetTextAlign.call(this, hdc, ground.align ?? 0);
    SetTextCharacterExtra.call(this, hdc, ground.extra ?? 0);

    /* The plotter faces are drawn as lines, and a line is the driver's -- and
     * a line that leaves the cell is GDI's, on the driver that cannot clip. */
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    // White to start with, as `PatBlt(..., WHITENESS)` left it.
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, cell, cell);

    /* The brush the probe selected: the white stock brush, unless `textbk`
     * selected the black one to ask whether `TextOut` uses it. */
    if (ground.brush) {
      surface.brush = new Brush(new Color(0, 0, 0));
    }

    /* The corner unless the record says otherwise: `textalin` draws in the
     * middle of the cell so an alignment has somewhere to move the text to. */
    const at = ground.at ?? null;

    this.textOut(surface, at ?? 2, at ?? 0, character);

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
    const surface: any = this.memoryCell(call.width ?? 64, call.height ?? 48);

    surface.font = font;
    this.textState(surface, { dark: call.dark, mode: call.mode, extra: call.extra ?? 0 });
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, call.width ?? 64, call.height ?? 48);

    const text = call.text ?? 'AB';
    const pen = [8, 4];

    if (call.textout) {
      this.textOut(surface, pen[0], pen[1], text);
    } else {
      this.extTextOut(
        surface,
        pen[0],
        pen[1],
        call.options,
        call.use ? call.rect : null,
        text,
        call.dx ?? null
      );
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

    const [penX, penY] = String(fields.pen ?? '32:32')
      .split(':')
      .map(Number);
    const surface: any = this.memoryCell(64, 64);

    surface.font = this.handles.resolve(handle);
    this.textState(surface, { mode: 1 });
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 64);

    this.textOut(surface, penX, penY, String(fields.text ?? 'A').replace(/^"|"$/g, ''));

    return this.readCell(surface, 64, 64);
  }

  drawTurned(font: any) {
    const surface: any = this.memoryCell(64, 64);

    surface.font = font;
    this.textState(surface, { mode: 1 });
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 64);

    this.textOut(surface, 32, 32, ROTATE_SPECIMEN);

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
  /**
   * `ExtTextOut` as a probe calls it: the rectangle and the distances placed in
   * guest memory as a `RECT` and an array of words, and the export called on a
   * device context for the surface. A null rectangle or distance array is a
   * null pointer.
   */
  extTextOut(
    surface: any,
    x: number,
    y: number,
    options: number,
    rect: { left: number; top: number; right: number; bottom: number } | null,
    text: string,
    dx: number[] | null
  ) {
    const core = this.machine.cpu.core;
    const words = (values: number[]) => {
      const at = this.place('', values.length * 2);

      values.forEach((value, index) =>
        core.write16(at.segment, at.offset + index * 2, value & 0xffff)
      );

      return at.far;
    };

    ExtTextOut.call(
      this,
      this.handles.allocate(surface),
      x,
      y,
      options,
      rect ? words([rect.left, rect.top, rect.right, rect.bottom]) : 0,
      this.lpcstr(text),
      text.length,
      dx ? words(dx) : 0
    );
  }

  /**
   * The text state a probe set on its context, set through the same calls:
   * the background colour, white unless `dark`; the background mode, 1 for
   * `TRANSPARENT` and 2 for `OPAQUE`; and the alignment and character extra
   * where the probe set them. Returns the device context.
   */
  textState(
    surface: any,
    state: { dark?: boolean; mode?: number; align?: number; extra?: number }
  ) {
    const hdc = this.handles.allocate(surface);

    SetBkColor.call(this, hdc, state.dark ? 0x000000 : 0xffffff);
    SetBkMode.call(this, hdc, state.mode ?? 2);

    if (state.align !== undefined) {
      SetTextAlign.call(this, hdc, state.align);
    }

    if (state.extra !== undefined) {
      SetTextCharacterExtra.call(this, hdc, state.extra);
    }

    return hdc;
  }

  /**
   * Text drawn the way a probe draws it: `TextOut` on a device context, so the
   * records measure the export a program calls rather than the surface under
   * it. The surface's font, colours, modes and alignment are set by the
   * caller, as the probe set them on its context.
   */
  textOut(surface: any, x: number, y: number, text: string) {
    TextOut.call(this, this.handles.allocate(surface), x, y, this.lpcstr(text), text.length);
  }

  /**
   * `Polygon` on the corners a `polyfill` record names, through the exported
   * call: the points placed in guest memory, the pen and brush selected, on a
   * white cell. A null pen is `null`.
   */
  drawPolygon(args: (string | number)[], pen: any, brush: any) {
    const pts = String(args.find((field) => String(field).startsWith('pts=')))
      .slice(4)
      .split(':')
      .map(Number);
    const surface: any = this.memoryCell(128, 128);

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 128, 128);
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.pen = pen ?? new Pen(new Color(0, 0, 0, 0));
    surface.brush = brush;

    const core = this.machine.cpu.core;
    const at = this.place('', pts.length * 2);

    pts.forEach((value, index) => core.write16(at.segment, at.offset + index * 2, value & 0xffff));

    Polygon.call(this, this.handles.allocate(surface), at.far, pts.length / 2);

    return inkRows(this.readCell(surface, 128, 128), 128);
  }

  /**
   * Lines drawn the way the probe drew them: `MoveTo` to the first point and
   * `LineTo` to each of the rest, through the exported calls on a device
   * context, so the records measure what a program reaches.
   */
  drawPath(points: number[][]) {
    const surface: any = this.memoryCell(32, 32);

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 32, 32);

    /* A line is the driver's to draw, and the drivers do not agree -- and one
     * that leaves the cell is GDI's, on the driver that cannot clip. */
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;

    const hdc = this.handles.allocate(surface);

    MoveTo.call(this, hdc, points[0][0], points[0][1]);

    for (const [x, y] of points.slice(1)) {
      LineTo.call(this, hdc, x, y);
    }

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
    const surface: any = this.memoryCell(64, 200);

    surface.font = font;
    surface.context.lineTie = this.display.lineTie;
    surface.context.clipCaps = this.display.clipCaps;
    surface.boldOverhang = this.display.boldOverhang;

    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 64, 200);

    this.textOut(surface, 2, 0, character);

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
  /**
   * The cell as the probe read it: `GetBitmapBits` on the bitmap selected into
   * the cell, so every recording of pixels checks that call as well. A set bit
   * is white, which is what the probe's background was.
   */
  readCell(surface: any, cell = 32, rows = cell) {
    const core = this.machine.cpu.core;
    const size = (cell / 8) * rows;
    const buffer = this.place('', size);

    GetBitmapBits.call(this, this.handles.lookup(surface.bitmap), size, buffer.far);

    let hex = '';

    for (let index = 0; index < size; index++) {
      hex += core
        .read8(buffer.segment, buffer.offset + index)
        .toString(16)
        .padStart(2, '0');
    }

    return hex;
  }

  /**
   * The pieces `bitblt` builds its cases from, all through the exported calls:
   * monochrome bitmaps from known bits, colour bitmaps compatible with the
   * screen, a ground painted with a solid brush, and the two sources of colour
   * the probe sets pixel by pixel.
   */
  bitblt() {
    const core = this.machine.cpu.core;
    const screen = this.handles.allocate(Surface.offscreen(1, 1));
    const PALETTE = [
      0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
      0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
    ];
    const FIVE = [0x0000ff, 0x00ff00, 0xff0000, 0xffffff, 0x000000];

    const withBitmap = (bitmap: number) => {
      const hdc = CreateCompatibleDC.call(this, 0);

      SelectObject.call(this, hdc, bitmap);

      return { hdc, bitmap };
    };

    const mono = (bytes: number[]) => {
      const at = this.place('', bytes.length);

      bytes.forEach((byte, index) => core.write8(at.segment, at.offset + index, byte));

      return withBitmap(CreateBitmap.call(this, 16, 2, 1, 1, at.far));
    };

    const colour = (ground: number | null = null) => {
      const made = withBitmap(CreateCompatibleBitmap.call(this, screen, 16, 2));

      if (ground !== null) {
        const brush = CreateSolidBrush.call(this, ground);

        SelectObject.call(this, made.hdc, brush);
        PatBlt.call(this, made.hdc, 0, 0, 16, 2, Gdi.PATCOPY);
      }

      return made;
    };

    const setEach = (made: { hdc: number }, pick: (x: number, y: number) => number) => {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 16; x++) {
          SetPixel.call(this, made.hdc, x, y, pick(x, y));
        }
      }

      return made;
    };

    const pixels = (hdc: number) => {
      const out: string[] = [];

      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 16; x++) {
          out.push((GetPixel.call(this, hdc, x, y) & 0xffffff).toString(16).padStart(6, '0'));
        }
      }

      return out.join('/');
    };

    const bits = (bitmap: number) => {
      const buffer = this.place('', 4);

      GetBitmapBits.call(this, bitmap, 4, buffer.far);

      return Array.from({ length: 4 }, (_, index) =>
        core
          .read8(buffer.segment, buffer.offset + index)
          .toString(16)
          .padStart(2, '0')
      ).join('');
    };

    const palette = () => setEach(colour(), (x) => PALETTE[x]);

    return {
      mono,
      colour,
      pixels,
      bits,
      palette,
      fivePattern: () => setEach(colour(), (x, y) => FIVE[(x + y) % 5]),
      onto: (ground: string, rop: number) => {
        const target = colour(parseInt(ground.slice(7), 16));

        BitBlt.call(this, target.hdc, 0, 0, 16, 2, palette().hdc, 0, 0, rop);

        return pixels(target.hdc);
      },
    };
  }

  /**
   * A cell to draw into, as every probe makes one: a memory device context
   * with a monochrome bitmap of the cell's size selected into it, through
   * `CreateCompatibleDC`, `CreateBitmap` and `SelectObject`. What is drawn
   * lands in the bitmap, and `readCell` reads it back with `GetBitmapBits`.
   */
  /** A `COLORREF` the probe wrote as six hex digits, which the parse may have read as a number. */
  hexColour(written: string | number) {
    return parseInt(String(written).padStart(6, '0'), 16);
  }

  /**
   * `dither`'s fill: a solid brush over a square of sixteen at `left:top` of a
   * bitmap compatible with the display, whose origin stands for the screen's,
   * each pixel read back with `GetPixel` as its place in the palette.
   */
  ditherSquare(colour: string | number, at: string) {
    const PALETTE = [
      0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
      0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
    ];
    const [left, top] = at.replace('at=', '').split(':').map(Number);
    const screen = this.handles.allocate(Surface.offscreen(1, 1));
    const hdc = CreateCompatibleDC.call(this, screen);

    SelectObject.call(this, hdc, CreateCompatibleBitmap.call(this, screen, 80, 64));
    SelectObject.call(this, hdc, CreateSolidBrush.call(this, this.hexColour(colour)));
    PatBlt.call(this, hdc, left, top, 16, 16, Gdi.PATCOPY);

    const rows: string[] = [];

    for (let y = 0; y < 16; y++) {
      let row = '';

      for (let x = 0; x < 16; x++) {
        const index = PALETTE.indexOf(GetPixel.call(this, hdc, left + x, top + y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      rows.push(row);
    }

    return rows.join('/');
  }

  /**
   * `penmatch` on a display it is not run whole on: one colour drawn one way
   * into a bitmap compatible with the display, or a monochrome one, over
   * white, and read back as the probe reads it. `glyph` is where a `|` of
   * the system font is first lit.
   */
  penmatch(kind: string, colour: string, mono: boolean) {
    const PALETTE = [
      0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
      0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
    ];
    const screen = this.handles.allocate(Surface.offscreen(1, 1));
    const hdc = CreateCompatibleDC.call(this, screen);
    const rgb = (colorref: number) =>
      [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');

    SelectObject.call(
      this,
      hdc,
      mono
        ? CreateBitmap.call(this, 64, 80, 1, 1, 0)
        : CreateCompatibleBitmap.call(this, screen, 64, 80)
    );
    PatBlt.call(this, hdc, 0, 0, 64, 80, Gdi.WHITENESS);

    const glyph = () => {
      SetBkMode.call(this, hdc, 1);
      TextOut.call(this, hdc, 0, 20, this.lpcstr('|'), 1);

      for (let y = 20; y < 40; y++) {
        for (let x = 0; x < 16; x++) {
          if ((GetPixel.call(this, hdc, x, y) & 0xffffff) === 0) {
            return [x, y];
          }
        }
      }

      return [-1, -1];
    };

    if (kind === 'glyph') {
      return glyph().join(',');
    }

    /* Written `rrggbb`, not as a `COLORREF` is; one of digits alone comes
     * here a number, without its leading noughts. */
    const hex = colour.padStart(6, '0');
    const clrref =
      parseInt(hex.slice(0, 2), 16) |
      (parseInt(hex.slice(2, 4), 16) << 8) |
      (parseInt(hex.slice(4, 6), 16) << 16);

    switch (kind) {
      case 'setpixel': {
        const set = SetPixel.call(this, hdc, 4, 4, clrref);

        return `${rgb(set)} ${rgb(GetPixel.call(this, hdc, 4, 4))}`;
      }

      case 'pen':
      case 'wide': {
        const wide = kind === 'wide';

        SelectObject.call(this, hdc, CreatePen.call(this, 0, wide ? 6 : 1, clrref));
        MoveTo.call(this, hdc, 0, wide ? 64 : 10);
        LineTo.call(this, hdc, wide ? 40 : 16, wide ? 64 : 10);

        if (!wide) {
          return rgb(GetPixel.call(this, hdc, 4, 10));
        }

        const rows: string[] = [];

        for (let y = 63; y <= 64; y++) {
          let row = '';

          for (let x = 8; x < 24; x++) {
            const index = PALETTE.indexOf(GetPixel.call(this, hdc, x, y) & 0xffffff);

            row += index < 0 ? '?' : index.toString(16);
          }

          rows.push(row);
        }

        return rows.join('/');
      }

      case 'text': {
        const [x, y] = glyph();

        PatBlt.call(this, hdc, 0, 0, 64, 80, Gdi.WHITENESS);
        SetTextColor.call(this, hdc, clrref);
        TextOut.call(this, hdc, 0, 20, this.lpcstr('|'), 1);

        return rgb(GetPixel.call(this, hdc, x, y));
      }

      case 'back':
        SetBkColor.call(this, hdc, clrref);
        this.extTextOut(
          this.handles.resolve(hdc),
          0,
          40,
          2 /* ETO_OPAQUE */,
          { left: 0, top: 40, right: 16, bottom: 48 },
          '',
          null
        );

        return rgb(GetPixel.call(this, hdc, 4, 44));
    }

    throw new NoAdapter(kind);
  }

  /**
   * `curves`: its shapes drawn through `Ellipse` and `RoundRect` on a bitmap
   * compatible with the screen, over white, and read back a row at a time
   * with `GetPixel` as palette digits. Drawn once for each display.
   */
  curvesCapture(): string[] {
    return this.screenCapture('curves', 240, 136, (hdc) => {
      const pens: Record<number, number> = {
        0: GetStockObject.call(this, Gdi.NULL_PEN),
        1: CreatePen.call(this, 0, 1, 0),
        3: CreatePen.call(this, 0, 3, 0),
      };

      PatBlt.call(this, hdc, 0, 0, 240, 136, Gdi.WHITENESS);

      for (const shape of CURVES) {
        const [kind, left, top, right, bottom, width, height, pen, brush] = shape;

        SelectObject.call(this, hdc, pens[pen]);
        SelectObject.call(this, hdc, GetStockObject.call(this, brush ? Gdi.LTGRAY_BRUSH : Gdi.NULL_BRUSH));

        if (kind) {
          RoundRect.call(this, hdc, left, top, right, bottom, width, height);
        } else {
          Ellipse.call(this, hdc, left, top, right, bottom);
        }
      }
    });
  }

  /**
   * `mixmode`: over stripes of white, black, blue and yellow, a rounded
   * rectangle and an ellipse in each drawing mode, and Calculator's key drawn
   * over itself with `R2_NOT`, as the probe draws them.
   */
  mixmodeCapture(): { rows: string[]; modes: string[] } {
    const modes = mixmodeModes.get(this.display.name) ?? [];

    mixmodeModes.set(this.display.name, modes);
    const rows = this.screenCapture('mixmode', 256, 112, (hdc) => {
      const stripes = [0xffffff, 0x000000, 0xff0000, 0x00ffff];
      const thin = CreatePen.call(this, 0, 1, 0x0000ff);
      const thick = CreatePen.call(this, 0, 3, 0x0000ff);
      const green = CreateSolidBrush.call(this, 0x00ff00);

      for (let x = 0; x < 256; x++) {
        SelectObject.call(this, hdc, CreateSolidBrush.call(this, stripes[x & 3]));
        PatBlt.call(this, hdc, x, 0, 1, 112, Gdi.PATCOPY);
      }

      for (let mode = 1; mode <= 16; mode++) {
        const left = ((mode - 1) & 7) * 32 + 2;
        const top = ((mode - 1) >> 3) * 44 + 2;

        SelectObject.call(this, hdc, thin);
        SelectObject.call(this, hdc, green);
        const was = SetROP2.call(this, hdc, mode);

        RoundRect.call(this, hdc, left, top, left + 28, top + 18, 8, 8);
        SelectObject.call(this, hdc, thick);
        Ellipse.call(this, hdc, left + 1, top + 22, left + 27, top + 40);
        modes[mode] = `was=${was},now=${GetROP2.call(this, hdc)}`;
        SetROP2.call(this, hdc, 13);
      }

      SelectObject.call(this, hdc, GetStockObject.call(this, Gdi.BLACK_PEN));

      for (let cell = 0; cell < 2; cell++) {
        const left = cell * 40 + 2;

        SelectObject.call(this, hdc, GetStockObject.call(this, Gdi.WHITE_BRUSH));
        RoundRect.call(this, hdc, left, 92, left + 36, 110, 10, 10);
        SelectObject.call(this, hdc, GetStockObject.call(this, Gdi.BLACK_BRUSH));
        SetROP2.call(this, hdc, 6);

        for (let times = 0; times <= cell; times++) {
          RoundRect.call(this, hdc, left, 92, left + 36, 110, 10, 10);
        }

        SetROP2.call(this, hdc, 13);
      }
    });

    return { rows, modes };
  }

  /**
   * Something drawn on a bitmap compatible with the screen and read back a
   * row at a time with `GetPixel`, as palette digits the way the probes write
   * them. Drawn once for each display.
   */
  screenCapture(name: string, width: number, height: number, draw: (hdc: number) => void): string[] {
    const key = `${name}:${this.display.name}`;
    const cached = screenCaptures.get(key);

    if (cached) {
      return cached;
    }

    const PALETTE = [
      0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
      0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
    ];
    const screen = this.handles.allocate(Surface.offscreen(1, 1));
    const hdc = CreateCompatibleDC.call(this, screen);

    SelectObject.call(this, hdc, CreateCompatibleBitmap.call(this, screen, width, height));
    draw(hdc);

    const rows: string[] = [];

    for (let y = 0; y < height; y++) {
      let row = '';

      for (let x = 0; x < width; x++) {
        const index = PALETTE.indexOf(GetPixel.call(this, hdc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      rows.push(row);
    }

    screenCaptures.set(key, rows);
    return rows;
  }

  /** `dither`'s brush into a monochrome bitmap of sixteen, read with `GetBitmapBits`. */
  ditherMono(colour: string | number) {
    const surface: any = this.memoryCell(16, 16);
    const hdc = this.handles.allocate(surface);

    SelectObject.call(this, hdc, CreateSolidBrush.call(this, this.hexColour(colour)));
    PatBlt.call(this, hdc, 0, 0, 16, 16, Gdi.PATCOPY);

    return this.readCell(surface, 16, 16);
  }

  memoryCell(width: number, height: number) {
    const hdc = CreateCompatibleDC.call(this, 0);
    const bitmap = CreateBitmap.call(this, width, height, 1, 1, 0);

    SelectObject.call(this, hdc, bitmap);

    return this.handles.resolve(hdc);
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
  /** Runs the profile probe's script on this context, up to the point named. */
  async profileScriptTo(label: string) {
    for (const step of PROFILE_SCRIPT) {
      if (step[0] === 'at') {
        if (step[1] === label) {
          return;
        }
      } else if (step[0] === 'flush') {
        await WritePrivateProfileString.call(this, null, null, null, this.lpcstr('PROBE.INI'));
      } else if (step[0] === 'windows') {
        const buffer = this.place('', 130);

        await GetProfileString.call(
          this,
          this.lpcstr('intl'),
          this.lpcstr('sTime'),
          this.lpcstr('<default>'),
          buffer.far,
          128
        );
      } else {
        const [, section, entry, value] = step;

        await WritePrivateProfileString.call(
          this,
          this.lpcstr(section),
          this.lpcstr(entry),
          value === null ? null : this.lpcstr(value),
          this.lpcstr('PROBE.INI')
        );
      }
    }

    throw new Error(`the profile script has no point called ${label}`);
  }

  /** A value read once the script has run to the point named. */
  async profileReadAt(label: string, [section, entry]: (string | number)[]) {
    await this.profileScriptTo(label);

    const buffer = this.place('', 130);
    const count = await GetPrivateProfileString.call(
      this,
      this.lpcstr(section as string),
      this.lpcstr(entry as string),
      this.lpcstr('<default>'),
      buffer.far,
      128,
      this.lpcstr('PROBE.INI')
    );

    return `${count},${quoted(this.fetch(buffer.far))}`;
  }

  /** The probe's file as this context's file system holds it now. */
  profileFile() {
    const handle = this.dos.files.open('PROBE.INI');
    const file = this.dos.files.resolve(handle);
    const bytes = file.read(0, file.size);

    this.dos.files.close(handle);

    return Array.from(bytes as Uint8Array, (byte: number) => String.fromCharCode(byte)).join('');
  }

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

/** Where the installed `.TTF` files are on the host. */
const DRIVE_FONTS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM');

/** The `.FOT` stub for a `fotmake` record's face, from the drive image. */
function fotFor(args: any[]) {
  const file = String(args[1]);

  if (!existsSync(join(DRIVE_FONTS, file))) {
    throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
  }

  const ttf = readFileSync(join(DRIVE_FONTS, file));

  return scalableFontResource(new Uint8Array(ttf), `C:\\WINDOWS\\SYSTEM\\${file}`);
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
      /* And `wsprintf` never writes an exponent, so anything that only reads
       * as a number *with* one is text: `fotmake`'s `+00e0` is a hexadecimal
       * offset, not nought times ten to the nought. Nor a binary or octal
       * prefix: `dither`'s `0b0000` is a colour, not nought in binary. */
      const value = /^[+-]?\d+e|^0[bo]/i.test(text.trim()) ? NaN : Number(text);

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

  /**
   * `loadstr`: USER's string 4 loaded into a buffer of a size, a guard byte
   * after it, as the probe writes it down.
   */
  async sized(context, [size]) {
    const module = userStrings(context);
    const buffer = context.place('#'.repeat(63), 64);
    const answer = await LoadString.call(context, module, 4, buffer.far, Number(size));
    const text = context.fetch(buffer.far);
    const guard = context.machine.cpu.core.read8(buffer.segment, buffer.offset + Number(size));

    return `answer=${answer},text=${text},guard=${guard === 0x23 ? 1 : 0}`;
  },

  /** `loadstr`: a string USER does not have. */
  async missing(context, [id]) {
    const buffer = context.place('#', 40);
    const answer = await LoadString.call(context, userStrings(context), Number(id), buffer.far, 40);

    return `answer=${answer},first=${String.fromCharCode(context.machine.cpu.core.read8(buffer.segment, buffer.offset))}`;
  },

  /* `rectops`: each call as the probe made it, by its label. */
  intersect(context, [label]) {
    const b = {
      overlap: [5, 5, 15, 15],
      touching: [10, 0, 20, 10],
      apart: [20, 20, 30, 30],
      empty: [3, 3, 3, 8],
    }[label as string]!;
    const out = rect(7, 7, 7, 7);

    return rectResult(IntersectRect(out, rect(0, 0, 10, 10), rect(b[0], b[1], b[2], b[3])), out);
  },

  union(context, [label]) {
    const out = rect(7, 7, 7, 7);
    const [first, second] = {
      apart: [rect(0, 0, 10, 10), rect(20, 20, 30, 30)],
      empty: [rect(0, 0, 10, 10), rect(50, 50, 50, 60)],
      'both-empty': [rect(50, 50, 50, 60), rect(40, 40, 30, 50)],
    }[label as string]!;

    return rectResult(UnionRect(out, first, second), out);
  },

  subtract(context, [label]) {
    const b = {
      width: [-5, 4, 15, 20],
      height: [4, -5, 20, 15],
      middle: [3, 3, 6, 6],
      all: [-1, -1, 11, 11],
    }[label as string]!;
    const out = rect(7, 7, 7, 7);

    return rectResult(SubtractRect(out, rect(0, 0, 10, 10), rect(b[0], b[1], b[2], b[3])), out);
  },

  empty(context, [label]) {
    const r = { ordinary: rect(0, 0, 10, 10), flat: rect(5, 5, 5, 9), inverted: rect(9, 9, 5, 5) }[
      label as string
    ]!;

    return rectResult(IsRectEmpty(r), r);
  },

  inflate(context, [dx, dy]) {
    const r = rect(0, 0, 10, 10);

    InflateRect(r, Number(dx), Number(dy));

    return rectResult(0, r);
  },

  equal(context, [label]) {
    if (label === 'same') {
      return rectResult(EqualRect(rect(0, 0, 10, 10), rect(0, 0, 10, 10)), rect(0, 0, 10, 10));
    }

    return rectResult(EqualRect(rect(1, 1, 1, 1), rect(2, 2, 2, 2)), rect(1, 1, 1, 1));
  },

  /* `dialogs`: each record from the probe replayed through the exports. See `replay-windows.ts`. */
  async units(context) {
    return (await dialogsCapture(context)).records.get('units:') ?? '';
  },

  async control(context, args) {
    if (context.probe === 'msgbox') {
      return (await editRecords(context)).get(`control:${args.join(',')}`) ?? '';
    }

    if (context.probe === 'groupbox') {
      return (await groupboxCapture(context)).get(`control:${args.join(',')}`) ?? '';
    }

    return (await dialogsCapture(context)).records.get(`control:${args.join(',')}`) ?? '';
  },

  async dialogfont(context, [name]) {
    return (await dialogsCapture(context)).records.get(`dialogfont:${name}`) ?? '';
  },

  async measure(context, [name]) {
    if (context.probe === 'listbox' || context.probe === 'combobox') {
      return (await editRecords(context)).get(`measure:${name}`) ?? '';
    }

    return (await dialogsCapture(context)).records.get(`measure:${name}`) ?? '';
  },

  async focus(context, args) {
    return (await dialogsCapture(context)).records.get(`focus:${args.join(',')}`) ?? '';
  },

  async command(context, args) {
    return (await dialogsCapture(context)).records.get(`command:${args.join(',')}`) ?? '';
  },

  async placement(context, args) {
    return (await dialogsCapture(context)).records.get(`placement:${args.join(',')}`) ?? '';
  },

  async modal(context, [what]) {
    return (await dialogsCapture(context)).records.get(`modal:${what}`) ?? '';
  },

  /** `dlgclamp`: an empty dialog at a place, partly off the screen or not. */
  async place(context, args) {
    const [x, y] = args.map((arg) => Number(String(arg).split('=')[1]));

    return dialogPlace(context, x, y);
  },

  /** `winhelp`: `HELP_QUIT` with Help not running. */
  quit(context, [file]) {
    return String(WinHelp.call(context, 0, file, 2, 0));
  },

  /** `quitord`: the message `PeekMessage` took at a place in the order. */
  async order(context, [index]) {
    /* `freemem`: the largest block no more than the free space. */
    if (context.probe === 'freemem') {
      return GlobalCompact.call(context, 0) <= GetFreeSpace.call(context, 0) ? 'yes' : 'no';
    }

    const { order } = await quitOrder(context);

    return order[Number(index)] ?? 'none';
  },

  /** `quitord`: how many times the quit came out. */
  async again(context) {
    return String((await quitOrder(context)).quits);
  },

  /**
   * `regmsg`: four strings registered in order, and what the numbers say of
   * each other. Each record replays the four from a fresh table.
   */
  register(context, [which]) {
    const strings = [
      'commdlg_FindReplace',
      'commdlg_FindReplace',
      'COMMDLG_FINDREPLACE',
      'winbox_probe_message',
    ];
    const messages = strings.map((text) => RegisterWindowMessage.call(context, text));

    if (which === 'first') {
      return `first=${messages[0].toString(16).padStart(4, '0')},range=${messages[0] >= 0xc000 ? 1 : 0}`;
    }

    return `again=${messages[1] === messages[0] ? 1 : 0},case=${messages[2] === messages[0] ? 1 : 0},other=${messages[3] !== messages[0] ? 1 : 0},next=${messages[3] - messages[0]}`;
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

  /* `localre`: blocks given new sizes, through the exports, in the replay's
   * own data segment. */
  re(context, [name]) {
    context.withLocalHeap();

    const core = context.machine.cpu.core;
    const ds = core.ds;
    const byteAt = (at: number) => core.read8(ds, at & 0xffff);
    const fill = (at: number, count: number) => {
      for (let i = 0; i < count; i++) core.write8(ds, (at + i) & 0xffff, 0x40 + i);
    };
    const step = (
      given: number,
      answer: number,
      before: number,
      pattern: number,
      moveable: boolean,
      defined = true
    ) => {
      if (!answer) {
        return 'answer=0';
      }

      const after = moveable ? LocalLock.call(context, answer) & 0xffff : answer;
      const size = LocalSize.call(context, answer);
      let kept = 0;

      while (kept < pattern && kept < size && byteAt(after + kept) === 0x40 + kept) kept++;

      let past = '';

      for (let i = pattern; defined && i < size && i < pattern + 8; i++) past += byteAt(after + i).toString(16).padStart(2, '0');

      if (moveable) LocalUnlock.call(context, answer);

      return `answer=${answer === given ? 'same' : 'other'},moved=${after !== before ? 1 : 0},size=${size},kept=${kept},past=${past}`;
    };

    const results = new Map<string, string>();
    let block = LocalAlloc.call(context, 0x0002, 16);
    let fence = LocalAlloc.call(context, 0, 16);
    let at = LocalLock.call(context, block) & 0xffff;

    fill(at, 16);
    LocalUnlock.call(context, block);
    results.set('moveable-grow', step(block, LocalReAlloc.call(context, block, 200, 0x0002), at, 16, true, false));
    at = LocalLock.call(context, block) & 0xffff;
    LocalUnlock.call(context, block);
    results.set('moveable-shrink', step(block, LocalReAlloc.call(context, block, 6, 0x0002), at, 6, true));
    at = LocalLock.call(context, block) & 0xffff;
    fill(at, 6);
    LocalUnlock.call(context, block);
    results.set('moveable-zeroinit', step(block, LocalReAlloc.call(context, block, 40, 0x0042), at, 6, true));
    LocalFree.call(context, block);
    LocalFree.call(context, fence);

    for (const size of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 30, 34, 38, 42, 46, 50, 54, 56, 58, 60]) {
      block = LocalAlloc.call(context, 0x0002, 64);
      fence = LocalAlloc.call(context, 0, 16);
      at = LocalLock.call(context, block) & 0xffff;
      fill(at, 64);
      LocalUnlock.call(context, block);
      results.set(`shrink-${size}`, step(block, LocalReAlloc.call(context, block, size, 0x0002), at, size, true));
      LocalFree.call(context, block);
      LocalFree.call(context, fence);
    }

    block = LocalAlloc.call(context, 0x0002, 16);
    at = LocalLock.call(context, block) & 0xffff;
    fill(at, 16);
    LocalUnlock.call(context, block);
    results.set('grow-last', step(block, LocalReAlloc.call(context, block, 30, 0x0002), at, 16, true, false));
    LocalFree.call(context, block);

    block = LocalAlloc.call(context, 0, 16);
    fence = LocalAlloc.call(context, 0, 16);
    fill(block, 16);
    results.set('fixed-grow-stay', step(block, LocalReAlloc.call(context, block, 200, 0), block, 16, false, false));
    const moved = LocalReAlloc.call(context, block, 200, 0x0002);
    results.set('fixed-grow-move', step(block, moved, block, 16, false, false));
    LocalFree.call(context, moved || block);
    LocalFree.call(context, fence);

    return results.get(String(name)) ?? '';
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

  /* `chrome`: every system colour and the metrics that size a frame, by
   * index. The windows' rectangles and pixels are recorded for USER's own
   * drawing, which is not replayed yet. */
  syscolor(context, [index]) {
    return (GetSysColor.call(context, Number(index)) & 0xffffff).toString(16).padStart(6, '0');
  },

  metric(context, [index]) {
    return String(GetSystemMetrics.call(context, Number(index)));
  },

  /* `chrome`: a window made and read back through the exports, on USER's
   * raster desktop. See `replay-windows.ts`. */
  async rects(context, [name]) {
    if (context.probe === 'groupbox') {
      return (await groupboxCapture(context)).get(`rects:${name}`) ?? '';
    }

    if (context.probe === 'dialogs') {
      return (await dialogsCapture(context)).records.get(`rects:${name}`) ?? '';
    }

    if (context.probe === 'sizing') {
      return (await sizingCapture(context)).rects.get(String(name)) ?? '';
    }

    const captured = await chromeCapture(context, String(name));

    if (!captured) {
      throw new Unimplemented(`no replay for the ${name} window`);
    }

    return captured.rects;
  },

  /* `menus`: a window's menus opened and read back through the exports. See `replay-windows.ts`. */
  async screen(context, args) {
    /* `dither` names its fills `screen` too: a colour and a place, not a capture and a row. */
    if (String(args[1] ?? '').startsWith('at=')) {
      return context.ditherSquare(args[0], String(args[1]));
    }

    const [name, row] = args;

    if (context.probe === 'curves' || context.probe === 'mixmode') {
      const rows =
        context.probe === 'curves' ? context.curvesCapture() : context.mixmodeCapture().rows;

      return rows[Number(String(row).replace('y=', ''))] ?? '';
    }

    if (context.probe === 'sizing' || context.probe === 'icons') {
      const capture =
        context.probe === 'sizing' ? await sizingCapture(context) : await iconsCapture(context);

      return capture.areas.get(String(name))?.rows[Number(String(row).replace('y=', ''))] ?? '';
    }

    const captured = await menusCapture(context);
    const rows = captured.get(String(name));

    if (!rows) {
      throw new Unimplemented(`the ${name} menu was not opened`);
    }

    return rows[Number(String(row).replace('y=', ''))] ?? '';
  },

  /* `curves`: each shape as the probe describes it, from its own table;
   * `showsb`: a window's scroll bar bits and rectangles. */
  async shape(context, [index]) {
    if (context.probe === 'showsb') {
      return (await showsbCapture(context)).get(`shape:${index}`) ?? '';
    }

    const [kind, left, top, right, bottom, width, height, pen, brush] = CURVES[Number(index)];

    return `${kind ? 'roundrect' : 'ellipse'},${left}:${top}:${right}:${bottom},corner=${width}:${height},pen=${pen},brush=${brush}`;
  },

  /* `editctl`: the edit control typed at, keyed and selected through the
   * exports on the raster desktop. See `replay-windows.ts`. */
  async blink(context) {
    return (await editCapture(context)).get('blink:') ?? '';
  },

  async caret(context, [step]) {
    return (await editRecords(context)).get(`caret:${step}`) ?? '';
  },

  async sel(context, [step]) {
    return (await editRecords(context)).get(`sel:${step}`) ?? '';
  },

  async text(context, args) {
    /* `penmatch` names its text colour's pixel `text` too. */
    if (context.probe === 'penmatch') {
      return context.penmatch('text', String(args[0]), !!args[1]);
    }

    return (await editRecords(context)).get(`text:${args.join(',')}`) ?? '';
  },

  /** `mmdevs`: how many devices of a kind. `environ`'s count is not replayed. */
  async count(context, args) {
    if (context.probe !== 'mmdevs') {
      throw new NoAdapter();
    }

    return (await editRecords(context)).get(`count:${args.join(',')}`) ?? '';
  },

  /** `mmdevs`: what opening a device answers. */
  async open(context, args) {
    if (context.probe !== 'mmdevs') {
      throw new NoAdapter();
    }

    return (await editRecords(context)).get(`open:${args.join(',')}`) ?? '';
  },

  /** `escapes`: what the display driver answers `QUERYESCSUPPORT` for, on the screen or a bitmap. */
  support(context, [what]) {
    if (context.probe !== 'escapes') {
      throw new NoAdapter();
    }

    const hdc =
      what === 'memory'
        ? CreateCompatibleDC.call(context, 0)
        : context.handles.allocate(new Surface({ getContext: () => ({}) }));
    const word = context.place('\0\0');
    const more = [256, 512, 1024, 2048, 4096, ...Array.from({ length: 33 }, (_, i) => 4096 + i).slice(1), 32767, -1];
    const found: string[] = [];

    for (const escape of [-2, ...Array.from({ length: 256 }, (_, i) => i), ...more]) {
      context.machine.cpu.core.write16(word.segment, word.offset, escape & 0xffff);

      const answer = (Escape.call(context, hdc, 8, 2, word.far, 0) << 16) >> 16;

      if (answer) {
        found.push(answer === 1 ? `${escape},` : `${escape}=${answer},`);
      }
    }

    return found.join('') || 'none';
  },

  /** `escapes`: `MOUSETRAILS`'s answer on the screen, and the word it leaves. */
  trails(context) {
    if (context.probe !== 'escapes') {
      throw new NoAdapter();
    }

    const hdc = context.handles.allocate(new Surface({ getContext: () => ({}) }));

    return `${(Escape.call(context, hdc, 39, 0, 0, 0) << 16) >> 16}:-99`;
  },

  /** `escapes`: an escape no driver has. */
  unknown(context) {
    if (context.probe !== 'escapes') {
      throw new NoAdapter();
    }

    const hdc = context.handles.allocate(new Surface({ getContext: () => ({}) }));

    return String(Escape.call(context, hdc, 7777, 0, 0, 0));
  },

  /** `mmdevs`: what asking a device's capabilities answers. */
  async caps(context, args) {
    if (context.probe !== 'mmdevs' && context.probe !== 'palette') {
      throw new NoAdapter();
    }

    return (await editRecords(context)).get(`caps:${args.join(',')}`) ?? '';
  },

  async notes(context, [step]) {
    return (await editRecords(context)).get(`notes:${step}`) ?? '';
  },

  async lines(context, [step]) {
    return (await editRecords(context)).get(`lines:${step}`) ?? '';
  },

  /* `listbox`: what a message answered, the state after a step, and each
   * `WM_DRAWITEM` the parent got. */
  /* `registry`: each key enumerated, and each value read. */
  async enum(context, args) {
    return (await editRecords(context)).get(`enum:${args.join(',')}`) ?? '';
  },

  async query(context, args) {
    return (await editRecords(context)).get(`query:${args.join(',')}`) ?? '';
  },

  /* `enumfam`: each family, and each font of a family by name. */
  async family(context, [index]) {
    return (await editRecords(context)).get(`family:${index}`) ?? '';
  },

  async style(context, args) {
    return (await editRecords(context)).get(`style:${args.join(',')}`) ?? '';
  },

  /* ...and the older call's: each face, each face's fonts by name, the answers. */
  async font(context, [index]) {
    return (await editRecords(context)).get(`font:${index}`) ?? '';
  },

  async fontname(context, args) {
    return (await editRecords(context)).get(`fontname:${args.join(',')}`) ?? '';
  },

  async oldanswer(context, [what]) {
    return (await editRecords(context)).get(`oldanswer:${what}`) ?? '';
  },

  /** `sysdirs`: what the Windows or system directory answers into a buffer of a size. */
  dir(context, [which, size]) {
    const buffer = context.place('untouched', 260);
    const answer = (which === 'windows' ? GetWindowsDirectory : GetSystemDirectory).call(
      context,
      buffer.far,
      Number(size)
    );

    return `${answer},${context.fetch(buffer.far)}`;
  },

  /** `freemem`: the free memory, which is the machine's, is not replayed. Nor
   * are `freelib`'s frees, whose probe runs whole in `run_program_test`. */
  free() {
    throw new NoAdapter();
  },

  /** `freemem`: the local heap's handle delta, by default, set, and after. */
  delta(context, [step]) {
    /* Each record is replayed afresh: `after` sets the delta itself first. */
    if (step === 'after') {
      LocalHandleDelta.call(context, 16);
    }

    return String(LocalHandleDelta.call(context, step === 'set-16' ? 16 : 0));
  },

  /** `msgbox`: a message box's place, caption, owner and focus. */
  async box(context, args) {
    return (await editRecords(context)).get(`box:${args.join(',')}`) ?? '';
  },

  /** `winflags`: what Windows says of the machine, `GetWinFlags` and `__WINFLAGS`. */
  flags(context, [name]) {
    if (context.probe !== 'winflags') {
      throw new NoAdapter();
    }

    return name === 'GetWinFlags'
      ? (GetWinFlags() >>> 0).toString(16).padStart(8, '0')
      : (exportedConstant('KERNEL', 178) ?? 0).toString(16).padStart(4, '0');
  },

  /** `spooljob`: the bytes `GetSpoolJob`'s option 14h wrote. */
  async buffer(context, args) {
    if (context.probe !== 'spooljob') {
      throw new NoAdapter();
    }

    return (await editRecords(context)).get(`buffer:${args.join(',')}`) ?? '';
  },

  /** `accres`: what `SizeofResource` answers for a resource of the probe's own. */
  async size(context, args) {
    return accresRecord(context, 'size', args);
  },

  /** `accres`: a resource's file opened by `AccessResource`, and what is read there. */
  async access(context, args) {
    return accresRecord(context, 'access', args);
  },

  /** `accres`: whether two calls give two handles. */
  async twice(context, args) {
    return accresRecord(context, 'twice', args);
  },

  /** `enumobj`: the pens or brushes `EnumObjects` handed over. */
  async objects(context, args) {
    return (await editRecords(context)).get(`objects:${args.join(',')}`) ?? '';
  },

  /** `enumobj`: the same, stopped by the callback at the third. */
  async stopped(context, args) {
    return (await editRecords(context)).get(`stopped:${args.join(',')}`) ?? '';
  },

  /** `misc`: the key and shift state a character is typed with. */
  async vk(context, args) {
    if (context.probe !== 'misc') {
      throw new NoAdapter();
    }

    return (await editRecords(context)).get(`vk:${args.join(',')}`) ?? '';
  },

  async answer(context, args) {
    return (await editRecords(context)).get(`answer:${args.join(',')}`) ?? '';
  },

  /** `selinfo`: the same of a code segment, without its limit. */
  async code(context, args) {
    return (await editRecords(context)).get(`code:${args.join(',')}`) ?? '';
  },

  /** `atoms`: a global atom step, as a relation. */
  async global(context, args) {
    return (await editRecords(context)).get(`global:${args.join(',')}`) ?? '';
  },

  /** `atoms`: a local atom step. */
  async local(context, args) {
    return (await editRecords(context)).get(`local:${args.join(',')}`) ?? '';
  },

  /** `atoms`: an atom's name, and the answer. */
  async name(context, args) {
    return (await editRecords(context)).get(`name:${args.join(',')}`) ?? '';
  },

  /** `atoms`: a clipboard format registered by name. */
  async format(context, args) {
    return (await editRecords(context)).get(`format:${args.join(',')}`) ?? '';
  },

  /** `activate`: an activation or focus message, by step and number. */
  async msg(context, args) {
    return (await editRecords(context)).get(`msg:${args.join(',')}`) ?? '';
  },

  async state(context, args) {
    const step = context.probe === 'mdiscrl' ? args.join(',') : args[0];

    return (await editRecords(context)).get(`state:${step}`) ?? '';
  },

  async draw(context, [index]) {
    return (await editRecords(context)).get(`draw:${index}`) ?? '';
  },

  async focused(context, [step]) {
    return (await editRecords(context)).get(`focused:${step}`) ?? '';
  },

  async caretpix(context, [name]) {
    return (await editRecords(context)).get(`caretpix:${name}`) ?? '';
  },

  async rows(context, args) {
    return (await editRecords(context)).get(`rows:${args.join(',')}`) ?? '';
  },

  /* `clip`: the formats listed, and the clipboard messages of a step. */
  async formats(context, [name]) {
    if (context.probe !== 'clip') {
      throw new NoAdapter();
    }

    return (await clipCapture(context)).get(`formats:${name}`) ?? '';
  },

  async messages(context, [name]) {
    if (context.probe !== 'clip') {
      throw new NoAdapter();
    }

    return (await clipCapture(context)).get(`messages:${name}`) ?? '';
  },

  /* `palette`: entries read back, and pixels drawn in a palette's colours. */
  async entries(context, [name]) {
    if (context.probe !== 'palette') {
      throw new NoAdapter();
    }

    return (await paletteCapture(context)).get(`entries:${name}`) ?? '';
  },

  async pixel(context, [name]) {
    if (context.probe !== 'palette') {
      throw new NoAdapter();
    }

    return (await paletteCapture(context)).get(`pixel:${name}`) ?? '';
  },

  /* `justify`: what `GetTextExtent` answered. */
  async extent(context, args) {
    if (context.probe !== 'justify') {
      throw new NoAdapter();
    }

    return (await justifyCapture(context)).get(`extent:${args.join(',')}`) ?? '';
  },

  /* `hooks`: the calls the hooks had during a step. */
  async calls(context, [name]) {
    if (context.probe !== 'hooks') {
      throw new NoAdapter();
    }

    return (await hooksCapture(context)).get(`calls:${name}`) ?? '';
  },

  /* `minis`: each record by its function's name and argument. */
  async menu(context, [name]) {
    return (await minisCapture(context)).get(`menu:${name}`) ?? '';
  },

  async ansi(context, [name]) {
    return (await minisCapture(context)).get(`ansi:${name}`) ?? '';
  },

  async cursor(context, [name]) {
    return (await minisCapture(context)).get(`cursor:${name}`) ?? '';
  },

  async task(context, [name]) {
    return (await minisCapture(context)).get(`task:${name}`) ?? '';
  },

  async top(context, [name]) {
    return (await minisCapture(context)).get(`top:${name}`) ?? '';
  },

  /* `showsb`: the messages a window was sent during a call, and after. */
  async sent(context, [name]) {
    if (context.probe !== 'showsb') {
      throw new NoAdapter();
    }

    return (await showsbCapture(context)).get(`sent:${name}`) ?? '';
  },

  async after(context, [name]) {
    if (context.probe !== 'showsb') {
      throw new NoAdapter();
    }

    return (await showsbCapture(context)).get(`after:${name}`) ?? '';
  },

  async visible(context, [name]) {
    if (context.probe !== 'showsb') {
      throw new NoAdapter();
    }

    return (await showsbCapture(context)).get(`visible:${name}`) ?? '';
  },

  /* `mapmode`: the origin and extent calls. */
  async set(context, [name]) {
    if (context.probe === 'hooks') {
      return (await hooksCapture(context)).get(`set:${name}`) ?? '';
    }

    if (context.probe !== 'mapmode') {
      throw new NoAdapter();
    }

    return (await mapmodeCapture(context)).get(`set:${name}`) ?? '';
  },

  /* `mapmode`: points through LPtoDP and DPtoLP. */
  async point(context, args) {
    if (context.probe !== 'mapmode') {
      throw new NoAdapter();
    }

    return (await mapmodeCapture(context)).get(`point:${args.join(',')}`) ?? '';
  },

  /* `clipdc`: SaveDC and RestoreDC. */
  async save(context, [name]) {
    if (context.probe !== 'clipdc') {
      throw new NoAdapter();
    }

    return (await clipdcCapture(context)).get(`save:${name}`) ?? '';
  },

  /* `patbrush`: what a pattern brush is. */
  async brush(context, [name]) {
    if (context.probe !== 'patbrush') {
      throw new NoAdapter();
    }

    return (await patbrushCapture(context)).get(`brush:${name}`) ?? '';
  },

  /* `mixmode`: what `SetROP2` answered, and `GetROP2` after. */
  async mode(context, [index]) {
    if (context.probe === 'mapmode') {
      return (await mapmodeCapture(context)).get(`mode:${index}`) ?? '';
    }

    if (context.probe === 'stretch') {
      return (await stretchCapture(context)).get(`mode:${index}`) ?? '';
    }

    return context.mixmodeCapture().modes[Number(index)];
  },

  /* `sizing`, `icons`, `curves` and `mixmode`: where each captured area was. */
  /* `combobox`: each combo box's window and its children, in the host's client area. */
  async rect(context, args) {
    return (await comboboxCapture(context)).get(`rect:${args.join(',')}`) ?? '';
  },

  async area(context, [name]) {
    if (context.probe === 'combobox') {
      return (await comboboxCapture(context)).get(`area:${name}`) ?? '';
    }

    if (context.probe === 'curves') {
      return '0:0:240:136';
    }

    if (context.probe === 'mixmode') {
      return '0:0:256:112';
    }

    const capture =
      context.probe === 'sizing' ? await sizingCapture(context) : await iconsCapture(context);

    return capture.areas.get(String(name))?.bounds ?? '';
  },

  /* `icons`: whether each standard icon loaded. `drvmsg`'s `loaded`, whether
   * its driver's library is, is checked with that probe run whole in
   * `run_program_test`. */
  async loaded(context, [name]) {
    if (context.probe !== 'icons') {
      throw new NoAdapter();
    }

    return (await iconsCapture(context)).loaded.get(String(name)) ?? '';
  },

  /* `sizing`: an icon's metrics, as `GetSystemMetrics` and `SystemParametersInfo` answer. */
  iconmetric(context, [name]) {
    const metrics: Record<string, number> = {
      SM_CXICON: 11,
      SM_CYICON: 12,
      SM_CXICONSPACING: 38,
      SM_CYICONSPACING: 39,
    };
    const spi: Record<string, number> = {
      SPI_ICONHORIZONTALSPACING: 13,
      SPI_ICONVERTICALSPACING: 24,
      SPI_GETICONTITLEWRAP: 25,
      SPI_GETICONTITLELOGFONT: 31,
    };
    const key = String(name);

    if (key in metrics) {
      return String(GetSystemMetrics.call(context, metrics[key]));
    }

    const buffer = context.place('', 64);

    SystemParametersInfo.call(context, spi[key], 0, buffer.far, 0);

    if (key !== 'SPI_GETICONTITLELOGFONT') {
      return String((context.machine.cpu.core.read16(buffer.segment, buffer.offset) << 16) >> 16);
    }

    const core = context.machine.cpu.core;
    const word = (at: number) => (core.read16(buffer.segment, buffer.offset + at) << 16) >> 16;
    let face = '';

    for (let at = 18; core.read8(buffer.segment, buffer.offset + at); at++) {
      face += String.fromCharCode(core.read8(buffer.segment, buffer.offset + at));
    }

    return (
      `height=${word(0)},width=${word(2)},weight=${word(8)},` +
      `italic=${core.read8(buffer.segment, buffer.offset + 10)},` +
      `charset=${core.read8(buffer.segment, buffer.offset + 13)},face=${face}`
    );
  },

  async pixels(context, [name, row]) {
    if (context.probe === 'groupbox') {
      return (await groupboxCapture(context)).get(`pixels:${name},${row}`) ?? '';
    }

    if (context.probe === 'dialogs') {
      const rows = (await dialogsCapture(context)).rows.get(String(name)) ?? [];

      return rows[Number(String(row).replace('y=', ''))] ?? '';
    }

    const captured = await chromeCapture(context, String(name));

    if (!captured) {
      throw new Unimplemented(`no replay for the ${name} window`);
    }

    return captured.rows[Number(String(row).replace('y=', ''))] ?? '';
  },

  /* `dither`: a solid brush filled over a square of the display, every pixel
   * read back as its place in the palette. The display is a bitmap compatible
   * with it, whose origin is the screen's. */
  offset(context, [colour, at]) {
    /* `rectops` records `OffsetRect` under the same name, by the amounts it moved. */
    if (context.probe === 'rectops') {
      const r = rect(0, 0, 10, 10);

      OffsetRect(r, Number(colour), Number(at));

      return rectResult(0, r);
    }

    return context.ditherSquare(colour, String(at));
  },

  /* `penmatch`, where it is not run whole. See `Context.penmatch`. */
  setpixel: (context, [colour, mono]) => context.penmatch('setpixel', String(colour), !!mono),
  pen: (context, [colour, mono]) => context.penmatch('pen', String(colour), !!mono),
  back: (context, [colour, mono]) => context.penmatch('back', String(colour), !!mono),
  wide: (context, [colour, mono]) => context.penmatch('wide', String(colour), !!mono),

  ramp(context, [colour, at]) {
    return context.ditherSquare(colour, String(at));
  },

  grid(context, [colour, at]) {
    return context.ditherSquare(colour, String(at));
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

  /* `bitblt`: every case rebuilt from nothing through the calls the probe
   * made, in memory device contexts, and read back with `GetBitmapBits` for a
   * monochrome bitmap and `GetPixel` for a colour one. */
  /* `dither`'s `GetNearestColor`, on the screen. */
  nearest(context, [colour]) {
    const screen = context.handles.allocate(Surface.offscreen(1, 1));
    const answer = GetNearestColor.call(context, screen, context.hexColour(colour));

    return (answer & 0xffffff).toString(16).padStart(6, '0');
  },

  monoramp(context, [colour]) {
    return context.ditherMono(colour);
  },

  mono(context, [name, , brush]) {
    /* `dither`'s `mono` is a colour alone: its brush into a monochrome bitmap. */
    if (brush === undefined) {
      return context.ditherMono(name);
    }

    const blt = context.bitblt();
    const source = blt.mono([0x33, 0x33, 0x33, 0x33]);
    const dest = blt.mono([0x55, 0x55, 0x55, 0x55]);

    SelectObject.call(
      context,
      dest.hdc,
      GetStockObject.call(context, brush === 'brush=white' ? Gdi.WHITE_BRUSH : Gdi.BLACK_BRUSH)
    );
    BitBlt.call(context, dest.hdc, 0, 0, 16, 2, source.hdc, 0, 0, Gdi[name as string]);

    return blt.bits(dest.bitmap);
  },

  'to colour'(context, args) {
    const [name] = args as string[];
    const blt = context.bitblt();
    const ground = parseInt(
      String(args.find((one) => String(one).startsWith('ground='))).slice(7),
      16
    );
    const source = blt.mono([0xf0, 0x0f, 0x0f, 0xf0]);
    const colour = blt.colour(ground);

    SetTextColor.call(context, colour.hdc, 0x0000ff);
    SetBkColor.call(context, colour.hdc, 0x00ff00);
    BitBlt.call(context, colour.hdc, 0, 0, 16, 2, source.hdc, 0, 0, Gdi[name]);

    return blt.pixels(colour.hdc);
  },

  'colour source'(context) {
    const blt = context.bitblt();

    return blt.pixels(blt.fivePattern().hdc);
  },

  'to mono'(context, [back]) {
    const blt = context.bitblt();
    const colour = blt.fivePattern();
    const dest = blt.mono([0x55, 0x55, 0x55, 0x55]);

    SetBkColor.call(context, colour.hdc, back === 'back=green' ? 0x00ff00 : 0x0000ff);
    BitBlt.call(context, dest.hdc, 0, 0, 16, 2, colour.hdc, 0, 0, Gdi.SRCCOPY);

    return blt.bits(dest.bitmap);
  },

  'palette source'(context) {
    const blt = context.bitblt();

    return blt.pixels(blt.palette().hdc);
  },

  xor(context, [ground]) {
    return context.bitblt().onto(String(ground), Gdi.SRCINVERT);
  },

  and(context, [ground]) {
    return context.bitblt().onto(String(ground), Gdi.SRCAND);
  },

  /* `bitbits`: a bitmap made from known bits or drawn into, read back through
   * `GetBitmapBits` into a buffer of 128 bytes filled with `0xAA`. The record
   * is the count and every byte of the buffer. */
  bits(context, args) {
    /* `handbits`: the low bits of each kind of handle. */
    if (context.probe === 'handbits') {
      return handbitsCapture(context).then((records) => records.get(`bits:${args.join(',')}`) ?? '');
    }

    const field = (name: string) =>
      String(args.find((one) => String(one).startsWith(`${name}=`)) ?? '').slice(name.length + 1);
    const core = context.machine.cpu.core;
    const bytes = (values: number[]) => {
      const at = context.place('', values.length);

      values.forEach((value, index) => core.write8(at.segment, at.offset + index, value));

      return at;
    };

    const width = Number(field('w'));
    const height = Number(field('h'));
    const created = args[0] === 'created';
    const source = created
      ? bytes(Array.from({ length: 128 }, (_, index) => index + 1))
      : bytes(new Array(128).fill(0));
    const bitmap = CreateBitmap.call(context, width, height, 1, 1, source.far);

    if (!created) {
      /* A memory context, as the probe makes one: only a memory context
       * takes a bitmap (`selbmp`). */
      const hdc = CreateCompatibleDC.call(context, 0);
      const [left, top, right, bottom] = field('rect').split(':').map(Number);

      SelectObject.call(context, hdc, bitmap);
      PatBlt.call(context, hdc, 0, 0, width, height, Gdi.WHITENESS);
      PatBlt.call(context, hdc, left, top, right - left, bottom - top, Gdi.BLACKNESS);
    }

    const buffer = bytes(new Array(128).fill(0xaa));
    const count = GetBitmapBits.call(context, bitmap, Number(field('buffer')), buffer.far);
    let hex = '';

    for (let index = 0; index < 128; index++) {
      hex += core
        .read8(buffer.segment, buffer.offset + index)
        .toString(16)
        .padStart(2, '0');
    }

    return `${count},${hex}`;
  },

  /* The caller's string after the write, and what reads back. The value is
   * placed in the scratch segment as the probe's copy was in its own, so a
   * write that changes it is seen. */
  async 'WritePrivateProfileString in place'(context, [entry, value]) {
    const copy = context.lpcstr(value as string);
    const before = (value as string).length;

    const ok = await WritePrivateProfileString.call(
      context,
      context.lpcstr('Plain'),
      context.lpcstr(entry as string),
      copy,
      context.lpcstr('PROBE.INI')
    );

    const after = context.fetch((copy.segment << 16) | copy.offset);
    const buffer = context.place('', 130);

    await GetPrivateProfileString.call(
      context,
      context.lpcstr('Plain'),
      context.lpcstr(entry as string),
      context.lpcstr('<gone>'),
      buffer.far,
      128,
      context.lpcstr('PROBE.INI')
    );

    return `${ok},${before},${after.length},${quoted(after)},${quoted(context.fetch(buffer.far))}`;
  },

  async 'WritePrivateProfileString flush'(context) {
    return String(
      await WritePrivateProfileString.call(context, null, null, null, context.lpcstr('PROBE.INI'))
    );
  },

  /* A value read at a point in the probe's script: after the flush, after a
   * further write, after `WIN.INI` was read. The function's name says which. */
  async 'GetPrivateProfileString after flush'(context, args) {
    return context.profileReadAt('after flush', args);
  },

  async 'GetPrivateProfileString after writing again'(context, args) {
    return context.profileReadAt('after writing again', args);
  },

  async 'GetPrivateProfileString after reading WIN.INI'(context, args) {
    return context.profileReadAt('after reading WIN.INI', args);
  },

  /* The file's bytes at a point in the script, as hex. */
  async 'file bytes'(context, [label]) {
    await context.profileScriptTo(label as string);

    return Array.from(context.profileFile(), (character) =>
      character.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('');
  },

  /* One line of the file at the end of the script, cut the way the probe cut
   * it: at each line feed, one carriage return before it dropped, and a last
   * piece kept only if it holds something. */
  async 'file line'(context, [number]) {
    await context.profileScriptTo('at the end');

    const text = context.profileFile();
    const lines: string[] = [];
    let start = 0;

    for (let at = 0; at <= text.length; at++) {
      if (at === text.length || text[at] === '\n') {
        let end = at;

        if (end > start && text[end - 1] === '\r') {
          end--;
        }

        if (at < text.length || end > start) {
          lines.push(text.substring(start, end));
        }

        start = at + 1;
      }
    }

    return lines[Number(number) - 1] ?? '';
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

  /* `smearrun` draws a made-up bold, one to four glyphs, with the pen at every
   * phase of a byte, and writes the ink and what the string measures. */
  'smear ink'(context, args) {
    const fields: Record<string, string> = {};

    for (const field of args.slice(1)) {
      const [name, value] = String(field).split('=');

      if (value !== undefined) {
        fields[name] = value;
      }
    }

    const face = String(args[0]).replace(/^"|"$/g, '');
    const text = String(fields.text).replace(/^"|"$/g, '');
    const handle = CreateFontIndirect.call(context, {
      lfHeight: Number(fields.h),
      lfWidth: 0,
      lfEscapement: Number(fields.esc ?? 0),
      lfOrientation: Number(fields.esc ?? 0),
      lfWeight: Number(fields.weight),
      lfItalic: 0,
      lfUnderline: 0,
      lfStrikeOut: 0,
      lfCharSet: face === 'Symbol' ? 2 : 0,
      lfPitchAndFamily: 0,
      lfFaceName: face,
    });

    if (!handle) {
      throw new Unimplemented('no font mapped');
    }

    /* `smearrun` draws upright on a canvas 48 high with the pen's row fixed;
     * `smearmod` names both halves of the pen and turns, on a square one. */
    const [penX, penY] = String(fields.pen).includes(':')
      ? String(fields.pen).split(':').map(Number)
      : [Number(fields.pen), 4];
    const height = fields.mode === undefined ? 48 : 128;
    const surface: any = context.memoryCell(128, height);

    surface.font = context.handles.resolve(handle);
    context.textState(surface, { mode: Number(fields.mode ?? 1) });
    surface.context.lineTie = context.display.lineTie;
    surface.context.clipCaps = context.display.clipCaps;
    surface.boldOverhang = context.display.boldOverhang;
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 128, height);
    context.textOut(surface, penX, penY, text);

    const bytes = Buffer.from(context.readCell(surface, 128, height), 'hex');
    const ink = (column: number, row: number) =>
      !(bytes[row * 16 + (column >> 3)] & (0x80 >> (column & 7)));
    let left = 128;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let row = 0; row < height; row++) {
      for (let column = 0; column < 128; column++) {
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
      let line = '';

      for (let column = left; column <= right; column += 4) {
        let nibble = 0;

        for (let bit = 0; bit < 4; bit++) {
          nibble = (nibble << 1) | (column + bit <= right && ink(column + bit, row) ? 1 : 0);
        }

        line += nibble.toString(16);
      }

      rows.push(line);
    }

    const hdc = context.handles.allocate(surface);
    SelectObject.call(context, hdc, handle);
    const extent = GetTextExtent.call(context, hdc, context.lpcstr(text), text.length) & 0xffff;

    return `box=${left}:${top}:${right}:${bottom},rows=${rows.join('/')},extent=${extent}`;
  },

  /* `polyfill` draws `Polygon` with a null pen and a black brush on a canvas
   * a hundred and twenty-eight square. What it measures is GDI's own fill,
   * which `Surface.fillPolygon` is; the API around it -- pens, brushes, the
   * winding rule -- is not asked. 8u.
   */
  'polygon ink'(context, args) {
    return context.drawPolygon(args, null, new Brush(new Color(0, 0, 0)));
  },

  /* With a black pen: the null brush for the outline alone, the black brush
   * for the outline over the fill. */
  'polygon outlined'(context, args) {
    const brush = args.find((field) => String(field).startsWith('brush='));
    const black = new Color(0, 0, 0);

    return context.drawPolygon(
      args,
      new Pen(black),
      brush === 'brush=black' ? new Brush(black) : new Brush(new Color(0, 0, 0, 0))
    );
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
    const surface: any = context.memoryCell(128, 128);

    surface.font = context.handles.resolve(handle);
    const state = context.textState(surface, {
      dark: !!opaque,
      mode: Number(fields.mode),
      align: Number(fields.align),
    });

    if (opaque) {
      SetTextColor.call(context, state, 0xffffff);
    } else {
      surface.textColor = null;
    }
    surface.context.lineTie = context.display.lineTie;
    surface.context.clipCaps = context.display.clipCaps;
    surface.boldOverhang = context.display.boldOverhang;
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 128, 128);

    if (what === 'ext') {
      const [dl, dt, dr, db] = String(fields.rect).split(':').map(Number);
      const rect = { left: 64 + dl, top: 64 + dt, right: 64 + dr, bottom: 64 + db };
      context.extTextOut(surface, 64, 64, Number(fields.opt), rect, 'AB', null);
    } else {
      context.textOut(surface, 64, 64, 'AB');
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
    const surface: any = context.memoryCell(160, 160);

    surface.font = font;
    context.textState(surface, { mode: 1 });
    surface.context.lineTie = context.display.lineTie;
    surface.context.clipCaps = context.display.clipCaps;
    surface.boldOverhang = context.display.boldOverhang;
    surface.brush = new Brush(new Color(0xff, 0xff, 0xff));
    surface.fillRect(0, 0, 160, 160);
    context.textOut(surface, 80, 80, String(fields.text ?? 'A').replace(/^"|"$/g, ''));

    const bytes = Buffer.from(context.readCell(surface, 160, 160), 'hex');
    const ink = (column: number, row: number) =>
      !(bytes[row * 20 + (column >> 3)] & (0x80 >> (column & 7)));

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
    const mapped = context.mappedFont([...fields, 'under=0', 'strike=0', 'charset=0', 'pitch=0']);
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
  async clip(context, args) {
    if (context.probe === 'clipdc') {
      return (await clipdcCapture(context)).get(`clip:${args[0]}`) ?? '';
    }

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
    return ADAPTERS.glyph(context, [args[0], args[1], 'back=1', 'opaque=1', 'cell=64', args[2]]);
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

  /* `fotmake` has `CreateScalableFontResource` make each installed face's
   * `.FOT` and reads it back: its size, then its bytes thirty-two at a time.
   * The stub is built from the same `.TTF` on the drive image. */
  made(context, args) {
    return `size=${fotFor(args).length}`;
  },

  stub(context, args) {
    const at = parseInt(String(args[2]).replace(/^\+/, ''), 16);
    return Buffer.from(fotFor(args).subarray(at, at + 32)).toString('hex');
  },

  /* `smearglf` asks `GetGlyphOutline` for a bitmap with the identity matrix
   * and writes back the metrics, the size and the bytes. */
  'glyph outline'(context, args) {
    const character = String(args[args.length - 1]).replace(/^'|'$/g, '');
    const { hdc } = context.mappedFont([
      ...args.slice(0, -1),
      String(args[0]).replace(/^"|"$/g, '') === 'Symbol' ? 'charset=2' : 'charset=0',
      'ori=' + String(args.find((field) => /^esc=/.test(String(field))) ?? 'esc=0').slice(4),
    ]);
    const metrics: any = {};
    const identity = {
      eM11fract: 0,
      eM11value: 1,
      eM12fract: 0,
      eM12value: 0,
      eM21fract: 0,
      eM21value: 0,
      eM22fract: 0,
      eM22value: 1,
    };
    const buffer = context.place('', 1024);
    const size =
      GetGlyphOutline.call(
        context,
        hdc,
        character.charCodeAt(0),
        1,
        metrics,
        1024,
        buffer.far,
        identity
      ) >>> 0;

    if (size === 0xffffffff) {
      return 'failed';
    }

    const core = context.machine.cpu.core;
    let bits = '';

    for (let at = 0; at < Math.min(size, 1024); at++) {
      bits += core
        .read8(buffer.segment, buffer.offset + at)
        .toString(16)
        .padStart(2, '0');
    }

    return `box=${metrics.gmBlackBoxX}:${metrics.gmBlackBoxY},origin=${metrics.gmptGlyphOriginX}:${metrics.gmptGlyphOriginY},inc=${metrics.gmCellIncX}:${metrics.gmCellIncY},size=${size},bits=${bits}`;
  },

  /* `simext` asks only `GetTextExtent`, of plain, smeared and slanted
   * strings upright and turned; the request is all in the arguments. */
  'sim extent'(context, args) {
    const fields = args.slice(0, -1).filter((field) => !/^text=/.test(String(field)));
    const text = String(args.find((field) => /^text=/.test(String(field)))).replace(
      /^text="|"$/g,
      ''
    );
    const { hdc } = context.mappedFont(fields);
    const extent = GetTextExtent.call(context, hdc, context.lpcstr(text), text.length);

    return `width=${extent & 0xffff},height=${(extent >> 16) & 0xffff}`;
  },

  'symbol extent'(context, args) {
    const { hdc } = context.mappedFont(['Symbol', ...args, 'w=0', 'weight=400', 'italic=0']);

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
  async glyph(context, args) {
    /* `penmatch`'s `glyph` is where its `|` is lit. */
    if (context.probe === 'penmatch') {
      return context.penmatch('glyph', '', false);
    }

    if (!context.fonts) {
      throw new NeedsDrive('the fonts live on the drive image; run the oracle pipeline');
    }

    if (context.probe === 'justify') {
      return (await justifyCapture(context)).get(`glyph:${args.join(',')}`) ?? '';
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
      brush: args.slice(1, -1).some((field) => String(field) === 'brush=1'),
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
  async line(context, args) {
    /* `dlgcolor` records a modal frame's pixels under each system colour made red. */
    if (context.probe === 'dlgcolor') {
      return (await dlgColorCapture(context)).get(String(args[0])) ?? '';
    }

    /* `mledit` records what `EM_GETLINE` copies of a line. */
    if (context.probe === 'mledit') {
      return (await editRecords(context)).get(`line:${args.join(',')}`) ?? '';
    }

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

/**
 * USER's own string tables as a module `LoadString` can read: the
 * installation's `USER.EXE`, whose strings the `loadstr` probe loaded.
 */
function userStrings(context: any) {
  const path = join(
    __dirname,
    '..',
    '..',
    'oracle',
    'build',
    'drive-c',
    'WINDOWS',
    'SYSTEM',
    'USER.EXE'
  );

  if (!existsSync(path)) {
    throw new NeedsDrive('USER.EXE is not built');
  }

  const tables = resourcesOf(new Uint8Array(readFileSync(path))).filter(
    (resource) => resource.type === 6
  );
  const executable = {
    resources: [{ id: 6, entries: tables.map((table) => ({ id: table.id, data: table.data })) }],
    readResource: async (entry: any) =>
      entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength),
  };

  return context.handles.allocate({ executable });
}

/** A rectangle, as the rectangle calls take one. */
function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

/** A rectangle call's answer and the rectangle it left, as `rectops` writes them. */
function rectResult(
  answer: number,
  r: { left: number; top: number; right: number; bottom: number }
) {
  return `${answer},${r.left}:${r.top}:${r.right}:${r.bottom}`;
}

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
  /* GlobalReAlloc growing a block past one allocated after it moves it in
   * Windows, its selector the same; winbox.js gives each selector a 64 KiB
   * place of its own and grows a block where it is. And FS, which no 16-bit
   * code of Windows loads, comes back from the call nought, reaching linear
   * nought, as from a trip to real mode (`segreg`, recorded in standard
   * mode); winbox.js's calls leave FS alone. One record each. */
  'segreg:moved':
    'a block grown past the next moves in Windows, its selector kept; winbox.js grows it where it is, one record',
  'segreg:selector':
    'FS comes back from GlobalReAlloc nought in Windows, as from a trip to real mode; winbox.js leaves it, one record',
  'segreg:fs':
    'FS comes back from GlobalReAlloc reaching linear nought in Windows; winbox.js leaves it holding the block, one record',

  /* A block given where a freed one was holds what it held, as in Windows,
   * but Windows' heap writes four bytes of its own into a freed block, its
   * free list, which winbox.js's heap does not keep (`lzero`). */
  'lzero:plain':
    "a block given where a freed one was holds the freed one's bytes, as in Windows, but for the four of Windows' free list, which winbox.js's heap does not keep",
  /* A program's first blocks, asked for without GMEM_ZEROINIT, hold what
   * Windows' memory held before -- in the recording, 3,869 of 4,096 bytes
   * and 7,415 and 6,673 of 8,448 are not nought (`gfresh`). That is the
   * state of the machine Windows ran on, not anything Windows does, and
   * winbox.js's memory starts as nought. Three records. */
  'gfresh:fresh':
    "a fresh block holds what Windows' memory held before, leftovers of the machine's earlier use; winbox.js's memory starts as nought, three records",
  /* A block freed is room for the next, as in Windows (`gcycle`'s `cycle`
   * and `after` agree); but how many blocks there is room for at once is
   * Windows' selectors less those its own modules and the shell hold, 7,680
   * of 1 KiB, where winbox.js's own hold fewer and it gives 8,084. */
  'gcycle:hold':
    "blocks freed are given again, as in Windows, but how many fit at once follows the selectors Windows' own modules hold, which are not modelled",

  /* A local heap made in a block of `GlobalAlloc`'s grows, as Windows' does,
   * to the same 80 blocks and the same `LocalReAlloc`; but where each block
   * lands, the handles given out and the sizes grown through follow Windows'
   * own layout -- its handle tables and each block's header -- which winbox.js's
   * heap does not keep (`lheapseg`). */
  'lheapseg:alloc':
    "the heap grows, but its handles and the points it grows at follow Windows' handle tables and block headers, which are not modelled",
  'lheapseg:count':
    "80 blocks are made, as in Windows, but the block's size after follows Windows' handle tables and block headers, which are not modelled",
  'lheapseg:realloc':
    "LocalReAlloc succeeds, as in Windows, but the block's size after follows Windows' handle tables and block headers, which are not modelled",

  /* A procedure given EnumTaskWindows without `MakeProcInstance`, which
   * USER calls with AX 1 (seg1 `1ad0`): its prologue, patched to three
   * `nop`s, takes the null selector 1 for its data segment. DOSBox, which
   * the recording was made under, lets memory be reached through it and
   * the procedure records nothing; a real processor faults, and winbox.js
   * follows the processor and ends the program (`nullds`). The probe makes
   * these calls last. */
  'minis3:tasks':
    'a procedure run with the null selector for its data segment faults here, as a real processor does; DOSBox lets it through',

  /* The same, measured on its own: DOSBox runs the procedure with the null
   * selector for its data segment, four times; a real processor faults on
   * its first read, and winbox.js ends the program there. */
  'nullds:answer':
    'a procedure run with the null selector for its data segment faults here, as a real processor does; DOSBox lets it through',

  /* KERNEL's pointer checks answer by touching the memory and catching the
   * fault. DOSBox raises none for the null selector, an offset past a
   * segment's limit, or a write to code, and they answered 0 there; a real
   * processor faults, and winbox.js answers 1, for all 12 (`bad-pointers.ts`). */
  'badptr:fault':
    '12 checks answer 1 where a real processor faults on the null selector, a limit or a write to code; DOSBox raises no fault and answered 0',

  /* What RegisterClass answers: 1 for the probe, a program made for Windows
   * 3.0. Windows 3.1 is documented to answer the class's atom, which may be
   * what a program made for 3.1 gets; not changed until that is measured. */
  'classinf:register': 'RegisterClass answers 1 for a program made for 3.0, which is not followed yet',

  /* CreatePolyPolygonRgn of three polygons: GDI hands its builder the count of
   * polygons where the count of points goes (`GDI.EXE` seg24 `02e5`), and
   * what it makes of that is not read out; winbox.js makes their union. One
   * polygon and two, which make no region, agree. */
  'regions:polypolygon':
    'three polygons make what GDI\'s builder makes of a count of three points, not yet read out',

  /* `WM_MEASUREITEM`'s item number for a list box of fixed heights, which
   * USER never sets (`USER.EXE` seg38 `0272`): what was left on its stack --
   * 2567 on the VGA, 2287 on the others -- which nothing can work out. Every
   * other field agrees. */
  'listbox:measure': 'the item number is whatever was left on the stack; every other field agrees',

  /* The combo box's two `WM_MEASUREITEM`s, one for its field and one for
   * its list: USER leaves the field's width and the list's item number unset
   * (`USER.EXE` seg34 `02ac`, seg38 `0278`), so each carries what was on the
   * stack -- 879, and 2567 -- which nothing can work out. Every other field
   * agrees. */
  'combobox:measure': 'the field\'s width and the list\'s item number are whatever was left on the stack',

  /* The numbers `RegisterWindowMessage` gives. Everything that relates them
   * agrees -- at least 0xC000, the same for a string in any case, another for
   * another string -- but Windows' first was 0xC40E, after whatever was
   * registered before the probe ran, and its next eight more, which follows
   * from how USER lays out its table. Neither is modelled; these count up
   * from 0xC000 by one. */
  'regmsg:register':
    'message numbers count from 0xC000 by one; Windows gave 0xC40E, then eight more',

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
   * What is not checked is the records the suite reports as **unsupported**,
   * which is a different thing from a disagreement and is why they are counted
   * apart. `stack` is 3,650 of them and is an instrument: the scaler's own
   * working memory, read to find where a number came from, which nothing here
   * is meant to reproduce.
   *
   * `fotmake`, which used to be the other 213, is a recording of a **real API
   * function**, and `CreateScalableFontResource` is implemented now: its 213
   * records are rebuilt byte for byte from the drive image's `.TTF` files. See
   * `FONTS.md` section 8c.
   */
};

/**
 * Functions a module declares but wires to a stub.
 *
 * Kept as an explicit list so that a stub reports as unimplemented rather than
 * as a disagreement -- the two want different work, and conflating them makes
 * the report harder to act on.
 */
const STUBBED = new Set<string>([
  /* WinG's halftone brushes: recorded by `wingapi`, their dither not worked
   * out, and `WinGCreateHalftoneBrush` makes none. */
  'halftone-brush',
]);

/**
 * Probes checked by running them whole, on a copy of the installation's
 * drive, rather than record by record: what they measure needs a program
 * running -- libraries loaded, drivers opened, callbacks called. Each runs
 * once, and each of its records is held to what it wrote. Without the drive
 * image, or the probe built, they are unsupported.
 */
const RUN_WHOLE = new Set<string>([
  'freelib',
  'findres',
  'gcycle',
  'greuse',
  'grealloc',
  'lzero',
  'gfresh',
  'segreg',
  'drivers',
  'drvmsg',
  'filecdr',
  'shlhook',
  'mcidevs',
  'getmsg',
  'minis2',
  'comms',
  'flash',
  'wndds',
  'about',
  'loadpath',
  'glock',
  'regions',
  'minis3',
  'shell2',
  'winexec',
  'shellex',
  'tasks2',
  'curdir',
  'updatecp',
  'nobrush',
  'tnrwrap',
  'tutor',
  'syscol',
  'uncover',
  'menubits',
  'syncpnt',
  'uncovr2',
  'menuinv',
  'menucar',
  'loadenv',
  'hidwnd',
  'owners',
  'enumregs',
  'fault',
  'nullinst',
  'classinf',
  'selalias',
  'mousemv',
  'movedef',
  'usedef',
  'cwphook',
  'defer',
  'stackpos',
  'polyline',
  'dibdev',
  'ovlstyle',
  'mmtime',
  'sysheap',
  'gdiobj',
  'badptr',
  'grow',
  'fillext',
  'brushind',
  'mcifile',
  'exfuncs',
  'penind',
  'ctlcolor',
  'dibmap',
  'winpoint',
  'lockupd',
  'getdib',
  'modhand',
  'sndplay',
  'unregcls',
  'wedges',
  'menuhelp',
  'minsize',
  'widelin',
  'widepoly',
  'nearest2',
  'dibpal',
  'penmatch',
  'inframe',
  'showseq',
  'showsq2',
  'showmin',
  'gdinum',
  'menuflag',
  'drawgaps',
  'iconkid',
  'iconclk',
  'patrops',
  'patmono',
  'queries',
  'scrolls',
  'tabtext',
  'updrgn',
  'gdidraw',
  'metafile',
  'printing',
  'userwin',
  'cursclip',
  'menubmp',
  'diskmeta',
  'setcur',
  'lheapseg',
  'devinfo',
  'loadname',
  'ownerpos',
  'reldc',
  'usedef2',
  'brushobj',
  'bkcolor',
  'dlgbrush',
  'selrgn',
  'brushorg',
  'ctltrans',
  'dlgpos',
  'actnext',
  'fontreq',
  'brushrlz',
  'dcreset',
  'btndis',
  'btnfocus',
  'btnclick',
  'btnkeys',
  'btnmore',
  'profnew',
  'multipfx',
  'defpush',
  'dlgneg',
  'palsys',
  'wingprof',
  'wingapi',
  'wingbig',
  'dpmidesc',
  'palreal',
  'paldib',
  'badarg',
  'instds',
  'glocks',
  'quitin',
  'nudges',
  'altchild',
  'stockdel',
  'capdbl',
  'comboact',
  'titledis',
  'search',
  'curerr',
  'mousemsg',
  'swpbits',
  'swporder',
  'nchit',
  'selbmp',
]);

/**
 * Whole-run probes recorded on other displays too, whose records there are
 * replayed one at a time through their adapters.
 */
const ADAPTED = new Set(['penmatch']);

/**
 * The keys a whole run presses when a box of USER's own that lets no program
 * run comes up, one list for each box, as the recording pressed them
 * (`record.mjs --shoot ... --then`).
 */
const BOX_KEYS: Record<string, string[][]> = {
  fault: [['Enter'], ['Enter']],
  minis3: [['Enter'], ['Enter']],
  nullds: [['Enter'], ['Enter']],
};

/**
 * Whole-run probes run on the machine's virtual clock, whose time is the
 * instructions run, rather than the host's. `comms` records how much of a
 * write at 110 baud has gone, a character in 91 ms, just after the write:
 * on the host's clock that hangs on the host not stalling for 91 ms between
 * two calls, which under a loaded run it can (it answered 300h for 400h).
 */
const VIRTUAL_CLOCK = new Set(['comms']);

const wholeRuns = new Map<string, Promise<Map<string, string[]> | null>>();

/**
 * What a probe wrote, run whole, by `function(args)`, each time it wrote it,
 * in order; null when it cannot run here. `btnclick` writes `step(radio,4,up)`
 * twice, the click and the release after the double click.
 */
function wholeRun(probe: string, display = 'vga') {
  const key = display === 'vga' ? probe : `${probe}-${display}`;

  if (!wholeRuns.has(key)) {
    wholeRuns.set(
      key,
      (async () => {
        if (!existsSync(imageFor(display)) || !existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`))) {
          return null;
        }

        const { fileSystem } = await runProbe(probe, 4000, false, true, 30, {
          boxKeys: BOX_KEYS[probe] ?? [],
          display,
          virtual: VIRTUAL_CLOCK.has(probe),
        });
        const written = new Map<string, string[]>();

        for (const line of recordsFrom((await outputOf(fileSystem, probe)) ?? '')) {
          const at = line.indexOf(') = ');
          const key = line.slice(0, at + 1);

          written.set(key, [...(written.get(key) ?? []), line.slice(at + 4)]);
        }

        return written;
      })()
    );
  }

  return wholeRuns.get(key)!;
}

/**
 * Runs one recorded call.
 *
 * Asynchronous because some of the functions are: anything that reads a file
 * suspends its task on the real thing, and the profile calls read one on every
 * lookup.
 */
export async function replayRecord(
  record: Fixture['records'][number],
  display = 'vga',
  probe = '',
  occurrence = 0
): Promise<Replayed> {
  const base = { function: record.function, args: record.args, expected: record.result };

  /* Recorded with a sound card (`--display vgasound`): this engine has
   * none, and its sound is the Rust engine's to give. */
  if (display === 'vgasound') {
    return { ...base, actual: null, outcome: 'unsupported' };
  }

  await prepareFonts(display);

  if (STUBBED.has(record.function)) {
    return { ...base, actual: null, outcome: 'unimplemented' };
  }

  if (RUN_WHOLE.has(probe) && (display === 'vga' || !ADAPTED.has(probe))) {
    /* A whole run is on the VGA installation; another display's recording
     * of the same probe is not replayed here. */
    /* `vgaprint` is the VGA with a printer; the run installs winbox.js's
     * own printer for a probe that prints (`run-probe.ts`). */
    /* And on the 256-colour installation, `build-drive.mjs --display
     * vga256`, a probe recorded only there. */
    const written =
      display === 'vga' || display === 'vgaprint'
        ? await wholeRun(probe)
        : display === 'vga256'
          ? await wholeRun(probe, display)
          : null;

    if (!written) {
      return { ...base, actual: null, outcome: 'unsupported' };
    }

    /* The record's own time of writing, where the probe wrote the same call
     * more than once; the last, where the run wrote it fewer times. */
    const values = written.get(`${record.function}(${record.args})`) ?? [];
    const actual = values[Math.min(occurrence, values.length - 1)] ?? null;

    return { ...base, actual, outcome: actual === record.result ? 'agreed' : 'disagreed' };
  }

  const adapter = ADAPTERS[record.function];

  if (!adapter) {
    return { ...base, actual: null, outcome: 'unsupported' };
  }

  let actual: string;

  try {
    const context = new Context(display);

    context.probe = probe;
    actual = await adapter(context, parseArgs(record.args));
  } catch (error) {
    if (error instanceof Unimplemented) {
      return { ...base, actual: null, outcome: 'unimplemented' };
    }

    if (error instanceof NeedsDrive || error instanceof NoAdapter) {
      return { ...base, actual: null, outcome: 'unsupported' };
    }

    return {
      ...base,
      actual: `threw ${error instanceof Error ? error.message + (process.env.STACKS ? error.stack : "") : String(error)}`,
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

  const seen = new Map<string, number>();

  for (const record of fixture.records) {
    const key = `${record.function}(${record.args})`;
    const occurrence = seen.get(key) ?? 0;

    seen.set(key, occurrence + 1);
    replayed.push(await replayRecord(record, fixture.display ?? 'vga', fixture.probe, occurrence));
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
    .map((name) => ({
      ...JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')),
      file: name.replace(/\.json$/, ''),
    }));
}
