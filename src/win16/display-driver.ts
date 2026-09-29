'use strict';

/** @namespace DisplayDriver */

import { Module } from './module.js';

/**
 * The display driver as a module: `DISPLAY`, whichever driver it is, as
 * Windows' own is found (`modhand`), and by the file the display mode names
 * (`driverFile`).
 *
 * The ordinals and names are the drivers' own export tables, the same for
 * the VGA, the Super VGA and the EGA, the Hercules's without
 * `SaveScreenBitmap` and the text entries of ordinals 400 to 403; the bytes
 * of arguments each takes are what its `retf` pops, read out of each file
 * (`argument-sizes.mjs`, which a test holds this to). `StrBlt` and
 * `ExtTextOut` pass to those entries on the colour drivers and pop what they
 * do, as the Hercules's own show. Ordinal 501 has no name in the file, and
 * none here; 502, whose size no driver's code gives, is left out. GDI draws
 * through winbox.js's own raster code, not these: each is a stub, marked as
 * one in a trace, that takes its arguments off the stack.
 *
 * @memberof Win16
 */
export function displayDriverFor(mode: any) {
  const monochrome = mode?.driverFile === 'HERCULES.DRV';

  return class DisplayDriver extends Module {
    static get name(): string {
      return 'DISPLAY';
    }

    static get path() {
      return `C:\\WINDOWS\\SYSTEM\\${mode?.driverFile ?? 'VGA.DRV'}`;
    }

    static get exports() {
      const exports: any[] = [];
      const stub = DisplayDriver.stub;

      exports[1] = [stub, 'BitBlt', 0x20];
      exports[2] = [stub, 'ColorInfo', 0xc];
      exports[3] = [stub, 'Control', 0xe];
      exports[4] = [stub, 'Disable', 0x4];
      exports[5] = [stub, 'Enable', 0x12];
      exports[6] = [stub, 'EnumDFonts', 0x10];
      exports[7] = [stub, 'EnumObj', 0xe];
      exports[8] = [stub, 'Output', 0x1c];
      exports[9] = [stub, 'Pixel', 0x10];
      exports[10] = [stub, 'RealizeObject', 0x12];
      exports[11] = [stub, 'StrBlt', 0x28];
      exports[12] = [stub, 'ScanLR', 0xe];
      exports[13] = [stub, 'DeviceMode', 0xc];
      exports[14] = [stub, 'ExtTextOut', 0x28];
      exports[15] = [stub, 'GetCharWidth', 0x18];
      exports[16] = [stub, 'DeviceBitmap', 0xe];
      exports[17] = [stub, 'FastBorder', 0x1c];
      exports[18] = [stub, 'SetAttribute', 0xc];
      exports[19] = [stub, 'DeviceBitmapBits', 0x1a];
      exports[20] = [stub, 'CreateBitmap', 0];
      exports[21] = [stub, 'DIBScreenBlt', 0x20];
      exports[90] = [stub, 'Do_Polylines', 0x1c];
      exports[91] = [stub, 'Do_Scanlines', 0x1c];
      exports[101] = [stub, 'Inquire', 0x4];
      exports[102] = [stub, 'SetCursor', 0x4];
      exports[103] = [stub, 'MoveCursor', 0x4];
      exports[104] = [stub, 'CheckCursor', 0];
      exports[500] = [stub, 'UserRepaintDisable', 0x2];
      exports[501] = [stub, '', 0x22];

      if (!monochrome) {
        exports[92] = [stub, 'SaveScreenBitmap', 0x6];
        exports[400] = [stub, 'PExtTextOut', 0x28];
        exports[401] = [stub, 'PStrBlt', 0x28];
        exports[402] = [stub, 'RExtTextOut', 0x28];
        exports[403] = [stub, 'RStrBlt', 0x28];
      }

      return exports;
    }

    static stub() {
      console.log('Stub called!');
    }
  };
}
