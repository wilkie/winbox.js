"use strict";

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

import { NULL } from '../consts.js';

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
    let file = this.dos.files.resolve(hf);

    if (!file || !(file instanceof File)) {
        return Kernel.HFILE_ERROR;
    }

    switch (nOrigin) {
        case 0:
            file.position = lOffset;
            break;

        case 1:
            file.position += lOffset;
            break;

        case 2:
            file.position = file.size - lOffset;
            break;

        default:
            // Unknown seek value, return error.
            return Kernel.HFILE_ERROR;
    }

    return file.position;
}
