'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

/**
 * The **_lwrite** function writes data to a file.
 *
 * The write starts wherever the file's position is and moves it along, so
 * repeated calls append -- which is what a program producing output does.
 *
 * **See also**:
 * {@link Kernel._lcreat _lcreat}
 * {@link Kernel._lread _lread}
 *
 * @static
 * @function _lwrite
 * @memberof Kernel
 *
 * @param {Types.HFILE} hf - The file to write to.
 * @param {Types.FARPTR} hpvBuffer - Points to the data to write.
 * @param {Types.UINT} cbBuffer - How many bytes to write.
 *
 * @return {Types.UINT} The number of bytes written, or HFILE_ERROR.
 */
export async function _lwrite(hf, hpvBuffer, cbBuffer) {
  const file = this.dos.files.resolve(hf);

  if (!file || !(file instanceof File) || cbBuffer > 0xfffe) {
    return Kernel.HFILE_ERROR;
  }

  // Gather the bytes out of the guest's address space.
  const cpu = this.machine.cpu.core;

  const segment = (hpvBuffer >> 16) & 0xffff;
  const offset = hpvBuffer & 0xffff;

  const bytes = new Uint8Array(cbBuffer);

  for (let index = 0; index < cbBuffer; index++) {
    bytes[index] = cpu.read8(segment, offset + index);
  }

  const written = await file.write(file.position, bytes);
  file.position += written;

  return written;
}
