"use strict";

import { Util } from '../../util.js';
import { Executable } from '../../executable.js';

import { Bitmap} from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

/**
 * The **LoadBitmap** function loads the specified bitmap resource from the
 * given module's executable file.
 *
 * If the bitmap pointed to by lpszBitmap does not exist or if there is
 * insufficient memory to load the bitmap, the function fails. The application
 * must call the {@link User.DeleteObject DeleteObject} function to delete each
 * bitmap handle returned by the **LoadBitmap** function. This also applies to
 * the following predefined bitmaps.
 *
 * An application can use the **LoadBitmap** function to access the predefined
 * bitmaps used by the system. To do so, the application must set the *`hinst`*
 * parameter to `NULL` and the *`lpszBitmap`* parameter to one of the following
 * values:
 *
 * * `OBM_BTNCORNERS`
 * * `OBM_BTSIZE`
 * * `OBM_CHECK`
 * * `OBM_CHECKBOXES`
 * * `OBM_CLOSE`
 * * `OBM_COMBO`
 * * `OBM_DNARROW`
 * * `OBM_DNARROWD`
 * * `OBM_DNARROWI`
 * * `OBM_LFARROW`
 * * `OBM_LFARROWD`
 * * `OBM_LFARROWI`
 * * `OBM_MNARROW`
 * * `OBM_OLD_CLOSE`
 * * `OBM_OLD_DNARROW`
 * * `OBM_OLD_LFARROW`
 * * `OBM_OLD_REDUCE`
 * * `OBM_OLD_RESTORE`
 * * `OBM_OLD_RGARROW`
 * * `OBM_OLD_UPARROW`
 * * `OBM_OLD_ZOOM`
 * * `OBM_REDUCE`
 * * `OBM_REDUCED`
 * * `OBM_RESTORE`
 * * `OBM_RESTORED`
 * * `OBM_RGARROW`
 * * `OBM_RGARROWD`
 * * `OBM_RGARROWI`
 * * `OBM_SIZE`
 * * `OBM_UPARROW`
 * * `OBM_UPARROWD`
 * * `OBM_UPARROWI`
 * * `OBM_ZOOM`
 * * `OBM_ZOOMD`
 * 
 * Bitmap names that begin with `OBM_OLD` represent bitmaps used by the system
 * in versions earlier than 3.0.
 *
 * The bitmaps identified by `OBM_DNARROWI`, `OBM_LFARROWI`, `OBM_RGARROWI`, and
 * `OBM_UPARROWI` are new for system version 3.1. These bitmaps are not found in
 * device drivers for previous versions of the system.
 *
 * **See also**:
 * {@link User.DeleteObject DeleteObject}
 *
 * @static
 * @function LoadBitmap
 * @memberof User
 *
 * @param {Types.HINSTANCE} hinst - Identifies the instance of the module whose
 *                                  executable file contains the bitmap to be
 *                                  loaded.
 * @param {Types.LPCSTR} lpszBitmap - Points to a null terminated string that
 *                                    contains the name of the bitmap resource
 *                                    to be loaded. Alternatively, this
 *                                    parameter can consist of the resource
 *                                    identifier in the low-order word and zero
 *                                    in the high-order word.
 *
 * @return {Types.HBITMAP} The return value is the handle of the specified
 *                         bitmap if the function is successful. Otherwise it is
 *                         `NULL`.
 */
export function LoadBitmap(hinst, lpszBitmap) {
    // If the hinst is NULL, we are looking for a system bitmap
    if (hinst == NULL) {
    }

    let hi = (lpszBitmap >> 16) & 0xffff;
    let lo = lpszBitmap & 0xffff;

    let idResource = 0;

    if (hi == 0) {
        // This is a resource identifier
        idResource = lo;

        // Resource ids that are integers have the high-bit set in the executable
        idResource |= 0x8000;
    }

    // Resolve the handle
    let module = this.handles.resolve(hinst);

    // Fail out if the handle is not found
    if (!module) {
        return NULL;
    }

    let memory = this.machine.memory;
    let executable = this.scheduler.task.executable;

    let ret = NULL;
    executable.resources.forEach( (resourceType) => {
        if (resourceType.id == Executable.RESOURCES.Bitmap) {
            resourceType.entries.forEach( (resource) => {
                if (resource.id == idResource) {
                    let data = executable.readResource(resource);
                    let view = new DataView(data);

                    // Read the bitmap header
                    let bitmapHeader = Util.readStructure(view, {
                        bcSize: [0, 4],
                        bcWidth: [4, -2],
                        bcHeight: [6, -2],
                        bcPlanes: [8, 2],
                        bcBitCount: [10, 2]
                    }, 0, true);

                    if (bitmapHeader.bcSize == 12) {
                        // We only have the BITMAPCOREHEADER
                        let bitmapData = data.slice(bitmapHeader.bcSize);
                        let bitmapView = new DataView(bitmapData);

                        // TODO: Place the bitmap into memory
                        // TODO: global heap that can allocate a handle and
                        //       move around objects in place.

                        let bitmap = new Bitmap(
                            bitmapHeader.bcWidth,
                            bitmapHeader.bcHeight,
                            bitmapHeader.bcBitCount,
                            Bitmap.ABGR,
                            bitmapView
                        );
                    }
                    else {
                        // We have the BITMAPINFOHEADER
                        bitmapHeader = Util.readStructure(view, {
                            biSize: [0, 4],
                            biWidth: [4, -4],
                            biHeight: [8, -4],
                            biPlanes: [12, 2],
                            biBitCount: [14, 2],
                            biCompression: [16, 4],
                            biSizeImage: [20, 4],
                            biXPelsPerMeter: [24, -4],
                            biYPelsPerMeter: [28, -4],
                            biClrUsed: [32, 4],
                            biClrImportant: [36, 4],
                        }, 0, true);

                        let bitmapData = data.slice(bitmapHeader.biSize);
                        let bitmapView = new DataView(bitmapData);

                        // Get the local heap.
                        let segment = this.machine.cpu.ds >> 3;
                        let heap = this.allocator.heapOf(segment);

                        // Place the bitmap into system memory
                        heap.insert(bitmapView);

                        // Create the Bitmap object
                        let bitmap = new Bitmap(
                            bitmapHeader.biWidth,
                            bitmapHeader.biHeight,
                            bitmapHeader.biBitCount,
                            Bitmap.ABGR,
                            bitmapView
                        );

                        // Allocate a handle to it
                        ret = this.handles.allocate(bitmap);
                    }

                    console.log(bitmapHeader);
                }
            });
        }
    });

    // If we could not find the string, ret remains 01
    return ret;
}
