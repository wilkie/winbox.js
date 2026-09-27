'use strict';

/**
 * How much of USER's and GDI's heaps is free, as a percentage. **Read out of
 * `USER.EXE`** (seg41 `1740`): for each of USER's three local heaps and
 * GDI's, `GetHeapSpaces` gives its size and what is free, and the
 * percentage is the free kilobytes a hundred times over the size's,
 * truncated. 0 answers the least of all four, 1 GDI's, and 2 the least of
 * USER's.
 *
 * winbox.js keeps no such heaps, so it answers what Windows 3.1 answers
 * freshly started with one program running, **recorded** by `about`: 88 for
 * 0 and 1, and 96 for 2. They do not fall as windows and objects are made.
 *
 * @param {Types.UINT} fuSysResource - 0, 1 or 2.
 *
 * @returns {Types.UINT} The percentage free.
 */
export function GetFreeSystemResources(this: any, fuSysResource: number) {
  return fuSysResource === 2 ? 96 : 88;
}
