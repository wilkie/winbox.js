'use strict';

/**
 * Gives up a block's address taken with `LocalLock`. With no lock count kept,
 * it answers FALSE, as for a block no longer locked.
 */
export function LocalUnlock(this: any, _hloc: number) {
  return 0;
}
