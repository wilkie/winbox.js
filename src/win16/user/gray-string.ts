'use strict';

import { Brush } from '../../raster/brush.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';
import { CreateBitmap } from '../gdi/CreateBitmap.js';
import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { PatBlt } from '../gdi/PatBlt.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { SetBkMode } from '../gdi/SetBkMode.js';
import { SetTextColor } from '../gdi/SetTextColor.js';
import { TextOut } from '../gdi/TextOut.js';
import { HDC, INT, LPARAM } from '../types.js';

/**
 * Text greyed, as a disabled control's is: `GrayString`. **Recorded** by
 * `tabtext`:
 *
 * * The text is drawn black on white in the device context's font on a
 *   monochrome bitmap of the size given -- the text's own extent when that
 *   is nought, and all of the text when the count is nought. Only the
 *   pixels of its glyphs where across and down, counted from its corner,
 *   add up to an even number are then painted in the brush: a gray brush
 *   makes dark grey dots, a black one black. Nothing else is touched.
 * * An output procedure, given, draws instead of the text. It is called
 *   with the monochrome bitmap's device context, not the one given, the
 *   data and the count.
 * * It answers TRUE.
 *
 * Not recorded: a procedure that answers FALSE, and a size of nought with a
 * procedure.
 */

const WHITENESS = 0x00ff0062;
const TRANSPARENT = 1;

function stringOf(system: any, pointer: number, count: number) {
  const core = system.machine.cpu.core;
  const segment = (pointer >>> 16) & 0xffff;
  let offset = pointer & 0xffff;
  let text = '';

  for (let at = 0; count <= 0 ? true : at < count; at++) {
    const byte = core.read8(segment, offset);

    if (count <= 0 && !byte) {
      break;
    }

    text += String.fromCharCode(byte);
    offset = (offset + 1) & 0xffff;
  }

  return text;
}

export async function GrayString(
  this: any,
  hdc: number,
  hbr: number,
  lpfnOutput: number,
  lpData: number,
  nCount: number,
  x: number,
  y: number,
  nWidth: number,
  nHeight: number
) {
  const surface = this.handles.resolve(hdc);
  const brush = this.handles.resolve(hbr);

  if (!(surface instanceof Surface)) {
    return 0;
  }

  const text = lpfnOutput ? '' : stringOf(this, lpData, nCount);
  let width = nWidth;
  let height = nHeight;

  if (!lpfnOutput && (!width || !height)) {
    const extent = text.length ? GetTextExtent.call(this, hdc, text, text.length) : 0;

    width ||= extent & 0xffff;
    height ||= extent >>> 16;
  }

  if (width <= 0 || height <= 0) {
    return 1;
  }

  const memory = CreateCompatibleDC.call(this, hdc);
  const bitmap = CreateBitmap.call(this, width, height, 1, 1, 0);
  const oldBitmap = SelectObject.call(this, memory, bitmap);
  const font = this.handles.lookup(surface.font);
  const oldFont = font ? SelectObject.call(this, memory, font) : 0;

  PatBlt.call(this, memory, 0, 0, width, height, WHITENESS);
  SetTextColor.call(this, memory, 0);
  SetBkMode.call(this, memory, TRANSPARENT);

  if (lpfnOutput) {
    await this.scheduler.callProc(
      lpfnOutput,
      [
        [memory, HDC],
        [lpData >>> 0, LPARAM],
        [nCount, INT],
      ],
      this.scheduler.stackRegisters()
    );
  } else if (text.length) {
    TextOut.call(this, memory, 0, 0, text, text.length);
  }

  const mask = this.handles.resolve(memory)?.bitmap;

  if (mask instanceof DeviceBitmap && brush instanceof Brush) {
    const old = surface.brush;

    surface.brush = brush;

    for (let py = 0; py < height; py++) {
      for (let px = py & 1; px < width; px += 2) {
        if (mask.indexAt(px, py) === 0) {
          surface.fillRect(x + px, y + py, 1, 1);
        }
      }
    }

    surface.brush = old;
  }

  if (oldFont) {
    SelectObject.call(this, memory, oldFont);
  }

  SelectObject.call(this, memory, oldBitmap);
  DeleteObject.call(this, bitmap);
  DeleteDC.call(this, memory);

  return 1;
}
