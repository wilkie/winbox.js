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

  /* DOS's write with DS:DX the buffer (`KRNL386.EXE` seg1 `0c42`): the bytes
   * on from it past offset FFFFh, where its block goes on, rather than round
   * to the segment's start (`lwrhuge`). Paintbrush saves a picture in
   * 61,440-byte pieces through one pointer moved on. */
  const address = this.machine.cpu.core.translateAddress(
    (hpvBuffer >>> 16) & 0xffff,
    hpvBuffer & 0xffff
  );
  const bytes = new Uint8Array(cbBuffer);

  for (let index = 0; index < cbBuffer; index++) {
    bytes[index] = this.machine.memory.read8(address + index);
  }

  /* Nought bytes is DOS's write with CX nought, which makes the file end
   * where it is (`KRNL386.EXE` seg1 `0c42`, function 40h). Program Manager
   * ends a group file it wrote again so (`PROGMAN.EXE` seg4 `05e9`).
   * **Recorded** by `progdde`: a group shorter than before has no bytes of
   * the old one after its end. */
  if (!cbBuffer) {
    /* And stamps it, as DOSBox's truncation of the host's file does
     * (`FAT16File.end`); as `kernel.rs`, whose truncation marks the file
     * written. */
    await (file as any).end?.(file.position);

    return 0;
  }

  const written = await file.write(file.position, bytes);
  file.position += written;

  return written;
}
