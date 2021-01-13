"use strict";

import { NULL } from '../consts.js';

import { Kernel } from '../kernel.js';

/**
 * The **GlobalAlloc** function allocates the specified number of bytes from the
 * global heap.
 *
 * To convert the handle returned by the **GlobalAlloc** function into a
 * pointer, an application should use the {@link Kernel.GlobalLock GlobalLock}
 * function.
 *
 * If this function is successful, it allocates at least the amount requested.
 * If the amount allocated is greater than the amount requested, the application
 * can use the entire amount. To determine the size of a global memory object,
 * an application can use the {@link Kernel.GlobalSize GlobalSize} function.
 *
 * To free a global memory object, an application should use the
 * {@link Kernel.GlobalFree GlobalFree} function. To change the size or
 * attributes of an allocated memory object, an application can use the
 * {@link Kernel.GlobalReAlloc GlobalReAlloc} function.
 *
 * The largest memory object that an application can allocate on an 80286
 * processor is 1 megabyte less 80 bytes. The largest block on an 80386
 * processor is 16 megabytes less 64K.
 *
 * If the `cbAlloc` parameter is zero, the **GlobalAlloc** function returns a
 * handle of a memory object that is marked as discarded.
 *
 * | fuAlloc Flag          | Meaning                                           |
 * |-----------------------|---------------------------------------------------|
 * |**`GHND`**             | Combines the `GMEM_MOVEABLE` and `GMEM_ZEROINIT` flags. |
 * |**`GMEM_DDESHARE`**    | Allocates sharable memory. This flag is used for dynamic data exchange (DDE) only. This flag is equivalent to `GMEM_SHARE`. |
 * |**`GMEM_DISCARDABLE`** | Allocates discardable memory. This flag can only be used with the `GMEM_MOVEABLE` flag. |
 * |**`GMEM_FIXED`**       | Allocates fixed memory. The `GMEM_FIXED` and `GMEM_MOVEABLE` flags cannot be combined. |
 * |**`GMEM_LOWER`**       | Same as `GMEM_NOT_BANKED`. This flag is ignored. |
 * |**`GMEM_MOVEABLE`**    | Allocates movable memory. The `GMEM_FIXED` and `GMEM_MOVEABLE` flags cannot be combined. |
 * |**`GMEM_NOCOMPACT`**   | Does not compact or discard memory to satisfy the allocation request. |
 * |**`GMEM_NODISCARD`**   | Does not discard memory to satisfy the allocation request. |
 * |**`GMEM_NOT_BANKED`**  | Allocates non-banked memory (memory is not within the memory provided by expanded memory). This flag cannot be used with the `GMEM_NOTIFY` flag. This flag is ignore. |
 * |**`GMEM_NOTIFY`**      | Calls the notification routine if the memory object is discarded. |
 * |**`GMEM_SHARE`**       | Allocates memory that can be shared with other applications. This flag is equivalent to `GMEM_DDESHARE`.
 * |**`GMEM_ZEROINIT`**    | Initializes memory contents to zero.
 * |**`GPTR`**             | Combines the `GMEM_FIXED` and `GMEM_ZEROINIT` flags.
 *
 * **See also**:
 * {@link Kernel.GlobalFree GlobalFree}
 * {@link Kernel.GlobalLock GlobalLock}
 * {@link Kernel.GlobalNotify GlobalNotify}
 * {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * {@link Kernel.GlobalSize GlobalSize}
 * {@link Kernel.GlobalUnlock GlobalUnlock}
 * {@link Kernel.LocalAlloc LocalAlloc}
 *
 * @static
 * @function GlobalAlloc
 * @memberof Kernel
 *
 * @param {Types.UINT} fuAlloc - Specifies how to allocate memory. This
 *                               parameter can be a combination of the specified
 *                               values above.
 * @param {Types.DWORD} cbAlloc - Specifies the number of bytes to be allocated.
 *
 * @returns {Types.HGLOBAL} The return value is a handle of the newly allocated
 *                          global memory object, if the function is successful.
 *                          Otherwise, it is `NULL`.
 */
export function GlobalAlloc(fuAlloc, cbAlloc) {
    // GlobalAlloc allocates to the system heap.

    // We can negotiate flags.
    // TODO: flags
    let options = {};

    if (fuAlloc & Kernel.GMEM_SHARE) {
        options.sharable = true;
    }

    if (fuAlloc & Kernel.GMEM_MOVEABLE) {
        options.movable = true;
    }

    if (fuAlloc & Kernel.GMEM_NOCOMPACT) {
        options.noCompact = true;
    }

    if (fuAlloc & Kernel.GMEM_NODISCARD) {
        options.noDiscard = true;
    }

    if (fuAlloc & Kernel.GMEM_ZEROINIT) {
        options.zeroInit = true;
    }

    if (fuAlloc & Kernel.GMEM_DISCARDABLE) {
        options.discardable = true;
    }

    // Get the system heap.
    let selector = this.allocator.allocate(cbAlloc);
    if (!selector) {
        // Cannot allocate
        return NULL;
    }

    return selector;
}
