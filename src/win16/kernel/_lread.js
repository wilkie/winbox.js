"use strict";

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

import { NULL } from '../consts.js';

/**
 * The **_lread** function reads data from the specified file.
 *
 * MS-DOS error return values are not available when an application calls this
 * function.
 *
 * **See also**:
 * {@link Kernel._lopen _lopen}
 * {@link Kernel.OpenFile OpenFile}
 *
 * @static
 * @function _lread
 * @memberof Kernel
 *
 * @param {Types.HFILE} hf - Identifies the file to be read.
 * @param {Types.FARPTR} hpvBuffer - Points to a buffer that is to receive the
 *                                   data read from the file.
 * @param {Types.UINT} cbBuffer - Specifies the number of bytes to be read from
 *                                the file. This value cannot be greater than
 *                                `0xfffe` (65,534).
 *
 * @returns {Types.LONG} The return value indicates the number of bytes that the
 *                       function read from the file, if the function is
 *                       successful. If the number of bytes read is less than
 *                       the number specified in `cbBuffer`, the function
 *                       reached the end of the file (EOF) before reading the
 *                       specified number of bytes. The return value is
 *                       `HFILE_ERROR` if the function fails.
 */
export async function _lread(hf, hpvBuffer, cbBuffer) {
    let file = this.dos.files.resolve(hf);

    if (cbBuffer > 0xfffe || !file || !(file instanceof File)) {
        return Kernel.HFILE_ERROR;
    }

    // Read the data
    let data = await file.read(file.position, cbBuffer);
    file.position += data.byteLength;

    // Copy the data to memory
    let destSegment = (hpvBuffer >> 16) & 0xffff;
    let destOffset = hpvBuffer & 0xffff;

    console.log("segment?", destSegment);

    let address = this.machine.cpu.core.translateAddress(destSegment, destOffset);
    this.machine.memory.write(address, new DataView(data));

    console.log("read", data);

    return data.byteLength;
}
