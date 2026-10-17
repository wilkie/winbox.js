'use strict';

import { LogicalFont } from '../../raster/logical-font.js';
/* `printer-driver.ts`, loaded when a printer driver's context first asks:
 * imported at the top, it would load KERNEL's and USER's modules in the
 * middle of GDI's. */
const printerDriver = () => import('./printer-driver.js');

/**
 * The **GetTextFace** function copies the typeface name of the current font
 * into a buffer.
 *
 * The name is the one that was asked for rather than the one that was found.
 * A program selecting Helv gets MS Sans Serif drawn, because `WIN.INI`
 * substitutes it, and is still told the face is Helv -- the substitution is
 * GDI's business and is deliberately not visible here.
 *
 * **See also**:
 * {@link Gdi.GetTextMetrics GetTextMetrics}
 *
 * @static
 * @function GetTextFace
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} cbBuffer - The size of the buffer, in bytes.
 * @param {Types.FARPTR} lpFace - Points to the buffer to receive the name.
 *
 * @return {Types.INT} The number of bytes copied, not counting the
 *                     terminating null, or zero if it could not be.
 */
export function GetTextFace(hdc, cbBuffer, lpFace) {
  const surface = this.handles.resolve(hdc);

  if (!surface || cbBuffer <= 0) {
    return 0;
  }

  /* A printer driver's from the drive: the face the driver realized
   * (`printer-driver.ts`). */
  if (surface.driverDevice) {
    return printerDriver().then(async ({ deviceFace, deviceFont }) => {
      const realized = await deviceFont(this, surface);

      return realized ? writeFace(this, deviceFace(this, surface, realized), cbBuffer, lpFace) : 0;
    });
  }

  const font = surface.font;

  if (!(font instanceof LogicalFont)) {
    return 0;
  }

  return writeFace(this, font.face, cbBuffer, lpFace);
}

/** A face's name copied to the buffer, as much as fits with its nought: the bytes copied. */
function writeFace(system: any, face: string, cbBuffer: number, lpFace: number) {
  const cpu = system.machine.cpu.core;

  /* A face whose name GDI no longer has -- an outline face whose stub was
   * removed -- is an empty name, its nought written (**recorded** by
   * `fontdef`). */
  if (!face) {
    if ((lpFace >>> 16) & 0xffff) {
      cpu.write8((lpFace >> 16) & 0xffff, lpFace & 0xffff, 0);
    }

    return 0;
  }

  const segment = (lpFace >> 16) & 0xffff;
  let offset = lpFace & 0xffff;

  // Room for the terminator has to come out of the buffer, not out of the name.
  const copied = Math.min(face.length, cbBuffer - 1);

  for (let index = 0; index < copied; index++) {
    cpu.write8(segment, offset++, face.charCodeAt(index) & 0xff);
  }

  cpu.write8(segment, offset, 0);

  return copied;
}
