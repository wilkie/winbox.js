'use strict';

import { hugeRead8 } from '../huge.js';

import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

import { NULL } from '../consts.js';

const CBM_INIT = 0x4;

/**
 * Makes a device-dependent bitmap from a device-independent one: the size
 * the header gives, at the depth of the device context -- the display's for
 * the screen, the selected bitmap's for a memory context, as
 * `CreateCompatibleBitmap` does -- and, with `CBM_INIT`, its pixels from the
 * bits and colour table given, each colour matched to the device's palette.
 *
 * `COMMDLG.DLL`'s File Open dialog makes its folder and drive pictures with
 * it. Not measured: `DIB_PAL_COLORS`, whose colour table is palette indices,
 * taken here as colours; and the colours a matched pixel gets, which follow
 * `LoadBitmap`'s.
 *
 * @param {Types.HDC} hdc - The device context whose kind of bitmap to make.
 * @param {Types.FARPTR} lpbmih - The `BITMAPINFOHEADER`.
 * @param {Types.DWORD} dwInit - `CBM_INIT` to fill it from `lpbInit`.
 * @param {Types.FARPTR} lpbInit - The bits.
 * @param {Types.FARPTR} lpbmi - The `BITMAPINFO`: header and colour table.
 * @param {Types.UINT} fuUsage - `DIB_RGB_COLORS` or `DIB_PAL_COLORS`.
 *
 * @returns {Types.HBITMAP} The bitmap, or `NULL`.
 */
export function CreateDIBitmap(hdc, lpbmih, dwInit, lpbInit, lpbmi, fuUsage) {
  const surface = hdc == NULL ? null : this.handles.resolve(hdc);
  const core = this.machine.cpu.core;
  const read = (far: number, count: number) =>
    Array.from({ length: count }, (_, at) => hugeRead8(core, far, at));
  const word = (far: number, at: number) => core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
  const dword = (far: number, at: number) => (word(far, at) | (word(far, at + 2) << 16)) >>> 0;

  if (!surface || !lpbmih) {
    return NULL;
  }

  const size = dword(lpbmih, 0);
  const coreHeader = size === 12;
  const width = coreHeader ? word(lpbmih, 4) : dword(lpbmih, 4) | 0;
  const height = Math.abs(coreHeader ? (word(lpbmih, 6) << 16) >> 16 : dword(lpbmih, 8) | 0);
  const like = surface.bitmap instanceof DeviceBitmap ? surface.bitmap : null;
  const depth = like ? like.depth : DevicePalette.depthOf(this.display);
  const palette = like ? like.devicePalette : DevicePalette.forDisplay(this.display, depth);

  if (!(dwInit & CBM_INIT) || !lpbInit || !lpbmi) {
    return this.handles.allocate(new DeviceBitmap(width, height, depth, undefined, palette));
  }

  /* The header and colour table from `lpbmi`, then the bits, laid out as a
   * resource holds a DIB. */
  const infoSize = dword(lpbmi, 0);
  const bitCount = infoSize === 12 ? word(lpbmi, 10) : word(lpbmi, 14);
  const used = infoSize === 12 ? 0 : dword(lpbmi, 32);
  const colours = bitCount <= 8 ? used || 1 << bitCount : 0;
  const entry = infoSize === 12 ? 3 : 4;
  const stride = ((width * bitCount + 31) >> 5) << 2;
  /* Compressed, the bits are as many bytes as the header says, not a
   * stride a row: StarMerc's run-length bitmaps are shorter, and reading a
   * stride a row ran past their block. */
  const compression = infoSize === 12 ? 0 : dword(lpbmi, 16);
  const bitsSize = compression ? dword(lpbmi, 20) : stride * height;
  const bytes = new Uint8Array([
    ...read(lpbmi, infoSize + colours * entry),
    ...read(lpbInit, bitsSize),
  ]);

  void fuUsage;

  try {
    return this.handles.allocate(dibToDevice(decodeDib(bytes), depth, palette, this.display));
  } catch {
    return NULL;
  }
}
