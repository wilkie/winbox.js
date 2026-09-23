import { TRUE, FALSE } from '../types.js';

/**
 * The **ExtTextOut** function writes a character string within a rectangular
 * region, using the currently selected font.
 *
 * It is `TextOut` with the three arguments `TextOut` has not got: a rectangle,
 * the flags that say what to do with it, and an array of distances one per
 * character.
 *
 *     ETO_OPAQUE    the rectangle is filled with the background colour first,
 *                   whatever the background mode says
 *     ETO_CLIPPED   nothing is drawn outside the rectangle, the mode's own
 *                   ground included
 *     neither       the rectangle is not read at all
 *
 * and the array, where one is passed, is what the pen moves by after each
 * character rather than what the character advances -- so its last entry is
 * never used, and `SetTextCharacterExtra` is added to each of them.
 *
 * **Recorded** by `oracle/probes/extout.c`, which draws two characters through
 * both calls at every combination of those, on a strike, an outline face and a
 * fixed-pitch outline face. The whole of `TextOut` is this call with no flags,
 * no rectangle and no array: the two come back pixel for pixel identical.
 *
 * @static
 * @function ExtTextOut
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} nXStart - The x-coordinate of the string's starting point.
 * @param {Types.INT} nYStart - The y-coordinate of the string's starting point.
 * @param {Types.UINT} fuOptions - `ETO_OPAQUE`, `ETO_CLIPPED`, or both.
 * @param {Types.FARPTR} lpRect - Points to a `RECT`, or is null.
 * @param {Types.LPCSTR} lpszString - Points to the string to be drawn.
 * @param {Types.UINT} cbString - The number of bytes in the string.
 * @param {Types.FARPTR} lpDx - Points to one distance per character, or is null.
 *
 * @return {Types.BOOL} Nonzero if the function is successful.
 */
export function ExtTextOut(
  hdc,
  nXStart,
  nYStart,
  fuOptions,
  lpRect,
  lpszString,
  cbString,
  lpDx
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return FALSE;
  }

  const text = String(lpszString).slice(0, cbString);
  const core = this.machine.cpu.core;

  const word = (far, index) => {
    const value = core.read16((far >> 16) & 0xffff, (far & 0xffff) + index * 2);

    return value >= 0x8000 ? value - 0x10000 : value;
  };

  /* A `RECT` is four words, and its right and bottom edges are outside it. */
  const rect = lpRect
    ? {
        left: word(lpRect, 0),
        top: word(lpRect, 1),
        right: word(lpRect, 2),
        bottom: word(lpRect, 3),
      }
    : null;

  const dx = lpDx ? Array.from({ length: text.length }, (_, index) => word(lpDx, index)) : null;

  if (rect && fuOptions & 0x0002) {
    surface.paintGround(rect);
  }

  surface.withClip(rect && fuOptions & 0x0004 ? rect : null, () => {
    surface.extText(nXStart, nYStart, text, dx);
  });

  return TRUE;
}
