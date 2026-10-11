'use strict';

/**
 * What USER takes from its display driver's `OEMBIN` 1 as it starts
 * (`USER.EXE` seg3 `0c9f`-`0ee2`, into its metrics at `1446`-`14f3`): by
 * `SM_` index, the thumbs' sizes (+0, +2), the icon's and the cursor's (+4 to
 * +A: as they are where the first is above 10, else 64 and 32 divided by
 * them), the Kanji window's height (+C) and the border's (+E, +10), the
 * dialog frame four borders; and the 19 default colours from +12, with
 * `COLOR_INACTIVECAPTIONTEXT` black and `COLOR_BTNHIGHLIGHT` white after them
 * (`0eb6`-`0ee2`). Null for a resource too short to hold them, or a divisor of
 * nought, on which USER would fault. See
 * `kb/topics/display-driver-resources.md`.
 */
export function oembinValues(data: Uint8Array) {
  if (data.length < 18 + 19 * 4) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const word = (at: number) => view.getInt16(at, true);
  const sizes = [word(4), word(6), word(8), word(10)];

  if (sizes[0] <= 10 && sizes.includes(0)) {
    return null;
  }

  const [iconX, iconY, cursorX, cursorY] =
    sizes[0] > 10
      ? sizes
      : [
          Math.trunc(64 / sizes[0]),
          Math.trunc(64 / sizes[1]),
          Math.trunc(32 / sizes[2]),
          Math.trunc(32 / sizes[3]),
        ];
  const borderX = word(14);
  const borderY = word(16);
  const metrics: Record<number, number> = {
    5: borderX,
    6: borderY,
    7: ((borderX * 4) << 16) >> 16,
    8: ((borderY * 4) << 16) >> 16,
    9: word(0),
    10: word(2),
    11: iconX,
    12: iconY,
    13: cursorX,
    14: cursorY,
    18: word(12),
  };
  const colors: number[] = [];

  for (let index = 0; index < 19; index++) {
    colors.push(view.getUint32(18 + index * 4, true));
  }

  colors.push(0x000000, 0xffffff);

  return { metrics, colors };
}
