'use strict';

/**
 * Whether a byte begins a two-byte character. **Read out of `KRNL386.EXE`**
 * (seg1 `8425`): this build answers FALSE for every byte, without looking at
 * it -- it has no lead bytes.
 *
 * @param {Types.BYTE} bTestChar - The byte.
 */
export function IsDBCSLeadByte(_bTestChar: number) {
  return 0;
}
