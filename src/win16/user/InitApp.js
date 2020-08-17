"use strict";

import { TRUE } from '../consts.js';

/**
 * The **InitApp** function creates the application queue and installs
 * application-support routines such as the signal procedure, version-
 * specific resource loaders, and the divide-by-zero interrupt routine.
 *
 * (Our system emulation does not need to really do anything for this)
 *
 * @static
 * @function InitApp
 * @memberof User
 *
 * @returns {Types.BOOL} Returns TRUE on success.
 */
export function InitApp(hInstance) {
    return TRUE;
}
