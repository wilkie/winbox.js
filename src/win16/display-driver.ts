'use strict';

/** @namespace DisplayDriver */

import { Module } from './module.js';
import { DWORD, INT } from './types.js';
import { driverResourceId } from './display-resource-id.js';

/** An export: its name, and the bytes of arguments its `retf` pops. */
type Entry = [string, number];

/**
 * The entries every Windows 3.1 display driver has, 1 to 18 and 101 to 104,
 * by their names in the drivers and the bytes each pops: `StrBlt` pushes
 * the five words `ExtTextOut` has that it has not and goes on as it, so its
 * own are 1Eh (`VGA.DRV` seg2 `082c`, `HERCULES.DRV` seg1 `108c`,
 * `8514.DRV` seg1 `1243`, `XGA.DRV` seg2 `1098`).
 */
const CORE: Record<number, Entry> = {
  1: ['BitBlt', 0x20],
  2: ['ColorInfo', 0xc],
  3: ['Control', 0xe],
  4: ['Disable', 0x4],
  5: ['Enable', 0x12],
  6: ['EnumDFonts', 0x10],
  7: ['EnumObj', 0xe],
  8: ['Output', 0x1c],
  9: ['Pixel', 0x10],
  10: ['RealizeObject', 0x12],
  11: ['StrBlt', 0x1e],
  12: ['ScanLR', 0xe],
  13: ['DeviceMode', 0xc],
  14: ['ExtTextOut', 0x28],
  15: ['GetCharWidth', 0x18],
  16: ['DeviceBitmap', 0xe],
  17: ['FastBorder', 0x1c],
  18: ['SetAttribute', 0xc],
  101: ['Inquire', 0x4],
  102: ['SetCursor', 0x4],
  103: ['MoveCursor', 0x4],
  104: ['CheckCursor', 0],
  500: ['UserRepaintDisable', 0x2],
};

/** The VGA's, the Super VGA's and the EGA's, which are the same. */
const VGA: Record<number, Entry> = {
  ...CORE,
  19: ['DeviceBitmapBits', 0x1a],
  20: ['CreateBitmap', 0],
  21: ['DIBScreenBlt', 0x20],
  90: ['Do_Polylines', 0x1c],
  91: ['Do_Scanlines', 0x1c],
  92: ['SaveScreenBitmap', 0x6],
  400: ['PExtTextOut', 0x28],
  401: ['PStrBlt', 0x1e],
  402: ['RExtTextOut', 0x28],
  403: ['RStrBlt', 0x1e],
  501: ['', 0x22],
};

/** The Hercules's: without `SaveScreenBitmap` and the text entries. */
const HERCULES: Record<number, Entry> = Object.fromEntries(
  Object.entries(VGA).filter(([ordinal]) => ![92, 400, 401, 402, 403].includes(Number(ordinal)))
);

/** The palette entries of the 256-colour drivers, 22 to 26. */
const PALETTE: Record<number, Entry> = {
  22: ['SetPalette', 0x8],
  23: ['GetPalette', 0x8],
  26: ['UpdateColors', 0xc],
};

/** `SVGA256.DRV`'s: its `StretchBlt`, its `StretchDIBits`, and the cards' own. */
const SVGA256: Record<number, Entry> = {
  ...CORE,
  ...PALETTE,
  19: ['DeviceBitmapBits', 0x1a],
  20: ['CreateBitmap', 0],
  21: ['DIBToDevice', 0x20],
  24: ['SetPaletteTranslate', 0x4],
  25: ['GetPaletteTranslate', 0x4],
  27: ['StretchBlt', 0x28],
  28: ['StretchDIBits', 0x32],
  450: ['GetDriverResourceID', 0x6],
  1000: ['SetColorTranslate', 0x4],
  ...Object.fromEntries(
    ['Tseng', 'V7', 'Trident', 'Oak', 'WD', 'ATI', 'Cirrus6420', 'Cirrus542X'].flatMap((card, at) =>
      ['SetBank', 'VideoInit', 'BltSpecial'].map((what, step) => [
        2000 + at * 3 + step,
        [`${what}_${card}`, 0] as Entry,
      ])
    )
  ),
};

/** The 8514/a's and the XGA's entries 19 to 28 and 92. */
const IBM: Record<number, Entry> = {
  ...CORE,
  ...PALETTE,
  18: ['SetAttribute', 0xa],
  19: ['MemoryDIBBits', 0x1a],
  20: ['CreateBitmap', 0],
  21: ['PhysicalDIBBits', 0x20],
  24: ['SetPalTrans', 0x4],
  25: ['GetPalTrans', 0x4],
  27: ['Spare2', 0],
  28: ['Spare3', 0],
  92: ['SaveScreenBitmap', 0x6],
  450: ['GetDriverResourceID', 0x6],
};

/**
 * `8514.DRV`'s: its routines for 8 and 4 bits, 200 to 226, and its text,
 * 240 and 241, where `Pixel` and `ExtTextOut` go (through `[06FDh]` and
 * `[0709h]`). Ordinals 501 to 506 are places in its data segment, not
 * functions, and are left out.
 */
const I8514: Record<number, Entry> = {
  ...IBM,
  200: ['WriteScreenColor8', 0],
  201: ['ReadScreenColor8', 0],
  202: ['Pixel8', 0x10],
  203: ['MemoryScanline8', 0],
  204: ['MemoryPolyline8', 0x1c],
  205: ['WriteScreenColor8_386', 0],
  206: ['ReadScreenColor8_386', 0],
  220: ['WriteScreenColor4', 0],
  221: ['ReadScreenColor4', 0],
  222: ['Pixel4', 0x10],
  223: ['MemoryScanline4', 0],
  224: ['MemoryPolyline4', 0x1c],
  225: ['WriteScreenColor4_386', 0],
  226: ['ReadScreenColor4_386', 0],
  240: ['ExtTextOutR', 0x28],
  241: ['ExtTextOutP', 0x28],
};

/** `XGA.DRV`'s: 501 to 548 have no names in the file. */
const XGA: Record<number, Entry> = {
  ...IBM,
  ...Object.fromEntries(
    [
      0, 0, 0, 2, 0, 6, 4, 0, 14, 0, 2, 2, 0, 2, 0, 0, 0, 10, 0, 8, 2, 6, 2, 8, 4, 8, 8, 6, 2, 6, 0,
      0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 4, 0, 8, 8,
    ].map((pops, at) => [501 + at, ['', pops] as Entry])
  ),
};

/** Each driver's table, by its file. */
const TABLES: Record<string, Record<number, Entry>> = {
  'VGA.DRV': VGA,
  'SUPERVGA.DRV': VGA,
  'EGA.DRV': VGA,
  'HERCULES.DRV': HERCULES,
  'SVGA256.DRV': SVGA256,
  '8514.DRV': I8514,
  'XGA.DRV': XGA,
};

/**
 * The display driver as a module: `DISPLAY`, whichever driver it is, as
 * Windows' own is found (`modhand`), and by the file the display mode names
 * (`driverFile`).
 *
 * The ordinals and names are each driver's own export table, and the bytes
 * of arguments each takes are what its `retf` pops, read out of each file
 * (`argument-sizes.mjs`, which a test holds this to for every driver). The
 * VGA, the Super VGA and the EGA have the same; the Hercules's is without
 * `SaveScreenBitmap` and the text entries of ordinals 400 to 403. Ordinal
 * 501 of the VGA's has no name in the file, and none here; 502, whose size
 * no driver's code gives, is left out. GDI draws through winbox.js's own
 * raster code, not these: each is a stub, marked as one in a trace, that
 * takes its arguments off the stack -- but for `GetDriverResourceID`, which
 * Control Panel's Color calls through `GetProcAddress` (`MAIN.CPL` seg6
 * `24ef`, `2922`), and which answers as the driver does
 * (`display-resource-id.ts`).
 *
 * @memberof Win16
 */
export function displayDriverFor(mode: any) {
  const table = TABLES[mode?.driverFile ?? 'VGA.DRV'] ?? VGA;

  return class DisplayDriver extends Module {
    static get name(): string {
      return 'DISPLAY';
    }

    static get path() {
      return `C:\\WINDOWS\\SYSTEM\\${mode?.driverFile ?? 'VGA.DRV'}`;
    }

    static get exports() {
      const exports: any[] = [];

      for (const [ordinal, [name, pops]] of Object.entries(table)) {
        exports[Number(ordinal)] = [DisplayDriver.stub, name, pops];
      }

      if (table[450]) {
        exports[450] = [GetDriverResourceID, 'GetDriverResourceID', 6, [INT, DWORD], DWORD];
      }

      return exports;
    }

    static stub() {
      console.log('Stub called!');
    }
  };
}

/**
 * The **GetDriverResourceID** function of a display driver: the number of
 * the resource to find for the one asked, by `GetDriverResourceID(id,
 * lpResType)`, as `MAKEINTRESOURCE` -- nought in the high word. The type is
 * not looked at. See `display-resource-id.ts`.
 */
function GetDriverResourceID(this: any, id: number, _type: number) {
  return driverResourceId(this.display, id & 0xffff) ?? id & 0xffff;
}
