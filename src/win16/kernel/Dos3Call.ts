'use strict';

import { dosCall } from './FileCdr.js';

/**
 * A DOS call made the way a Windows program is meant to make one: the
 * registers set as for INT 21h, and a far call here instead of the interrupt.
 * It is the same call: the registers go to DOS as they are, and come back as
 * DOS leaves them, the carry flag with them. File Manager lists directories
 * through it.
 */
export async function Dos3Call(this: any) {
  await dosCall(this);
}
