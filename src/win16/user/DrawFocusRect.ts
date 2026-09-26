'use strict';

/**
 * The dotted focus rectangle, as the list box and the combo box draw it
 * (see `Desktop.focusRectangle`): each side exclusive-ored with a grey
 * pattern in the context's text and background colours -- the background's
 * where the coordinates add to an odd number, the text's where even -- so
 * drawing it again takes it away. The right and bottom edges are outside it.
 * **Recorded** through `listbox` and `combobox`, which draw theirs this way.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.RECT} lprc - The rectangle.
 */
export function DrawFocusRect(this: any, hdc: number, lprc: any) {
  const surface = this.handles.resolve(hdc);
  const bitmap = surface?.bitmap;

  if (!lprc || !bitmap?.devicePalette || typeof bitmap.indexAt !== 'function') {
    return;
  }

  const index = (colour: any, fallback: number) =>
    colour ? bitmap.devicePalette.index(colour.red, colour.green, colour.blue) : fallback;
  const ink = index(surface.textColor, 0);
  const ground = index(surface.backcolor, (1 << bitmap.depth) - 1);
  const { left, top, right, bottom } = lprc;
  const flip = (x: number, y: number) => {
    const was = bitmap.indexAt(x, y);

    if (was !== null && was !== undefined) {
      bitmap.put(x, y, was ^ ((x + y) & 1 ? ground : ink));
    }
  };

  for (let x = left; x < right; x++) {
    flip(x, top);
    flip(x, bottom - 1);
  }

  for (let y = top; y < bottom; y++) {
    flip(left, y);
    flip(right - 1, y);
  }

  bitmap.context?.markRect?.(left, top, right, bottom);
}
