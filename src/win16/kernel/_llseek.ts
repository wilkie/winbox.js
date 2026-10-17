'use strict';

import { File } from '../../file-system.js';

/**
 * The **_llseek** function repositions the pointer in a previously opened file.
 * longer available for reading or writing.
 *
 * When a file is initially opened, the file pointer is positioned at the
 * beginning of the file. The **_lseek** function permits random access to a
 * file's contents by moving the pointer an arbitrary amount without reading
 * data.
 *
 * The `nOffset` parameter can be one of the following values:
 *
 * | Value | Meaning                                                               |
 * |-------|-----------------------------------------------------------------------|
 * | `0`   | Move the file pointer `lOffset` bytes from the beginning of the file. |
 * | `1`   | Move the file pointer `lOffset` bytes from its current position.      |
 * | `2`   | Move the file pointer `lOffset` bytes from the end of the file.       |
 * |-------|-----------------------------------------------------------------------|
 *
 * **See also**:
 * {@link Kernel._lopen _lopen}
 * {@link Kernel.OpenFile OpenFile}
 *
 * @static
 * @function _llseek
 * @memberof Kernel
 *
 * @param {Types.HFILE} hf - Identifies the file.
 * @param {Types.LONG} lOffset - Specifies the numbers of bytes the pointer is
 *                               to be moved.
 * @param {Types.INT} nOffset - Specifies the starting position and direction of
 *                              of the pointer. This parameter must be one of
 *                              the values given in the description.
 *
 * @returns {Types.LONG} The return value specifies the new offset, in bytes, of
 *                       the pointer from the beginning of the file, if the
 *                       function is successful. Otherwise, the return value is
 *                       `HFILE_ERROR`.
 */
export function _llseek(hf, lOffset, nOrigin) {
  const file = this.dos.files.resolve(hf);

  /* An error is `HFILE_ERROR` in both words, -1 (**recorded** by `lzfiles`:
   * LZEXPAND's `LZSeek` answers KERNEL's answer for a DOS handle). */
  if (!file || !(file instanceof File)) {
    return -1;
  }

  let to: number;

  switch (nOrigin) {
    case 0:
      to = lOffset | 0;
      break;

    case 1:
      to = (file.position + lOffset) | 0;
      break;

    case 2:
      to = (file.size + lOffset) | 0;
      break;

    default:
      // Unknown seek value, return error.
      return -1;
  }

  /* Before the start: DOSBox's host seek fails, and it puts the file at its
   * end instead (`localFile::Seek`); **recorded** by `lzfiles`. */
  file.position = to < 0 ? file.size : to;

  return file.position;
}
