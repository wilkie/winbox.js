'use strict';

/**
 * The Color dialog's arithmetic: hue, luminosity and saturation from a
 * colour and back, each on a scale of 240, in COMMDLG's own sixteen bit
 * words. **Read out** of `COMMDLG.DLL` seg1 (`281d`, `29f1`, `2999`) and
 * **recorded** by `choosclr`'s `rgb` and `hls` records. The twin of
 * `crates/winbox-win16/src/commdlg/colour_math.rs`.
 */

const word = (n: number) => n & 0xffff;

/**
 * A colour as hue, luminosity and saturation (seg1 `281d`): luminosity the
 * sum of the largest and smallest of red, green and blue on 240 (rounded by
 * 255 over 510); grey has no saturation and a hue of 160.
 */
export function rgbToHls(rgb: number): [number, number, number] {
  const r = rgb & 0xff;
  const g = (rgb >>> 8) & 0xff;
  const b = (rgb >>> 16) & 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sum = max + min;
  const l = Math.floor((sum * 240 + 255) / 510);
  const d = max - min;

  if (d === 0) {
    return [160, l, 0];
  }

  const rest = l <= 120 ? sum : 510 - sum;
  const s = Math.floor((d * 240 + (rest >>> 1)) / rest);
  const delta = (c: number) => Math.floor(((max - c) * 40 + (d >>> 1)) / d);
  let h =
    max === r
      ? delta(b) - delta(g)
      : max === g
        ? delta(r) - delta(b) + 80
        : delta(g) - delta(r) + 160;

  if (h < 0) {
    h += 240;
  }

  if (h >= 240) {
    h -= 240;
  }

  return [h, l, s];
}

/** One of red, green and blue for a hue (seg1 `2999`): a hue past 240 has 240 taken from it once. */
function hueToRgb(m1: number, m2: number, hue: number) {
  const h = hue >= 240 ? word(hue - 240) : hue;
  const ramp = (n: number) => word(m1 + Math.floor(word(word(word(m2 - m1) * n) + 20) / 40));

  if (h < 40) {
    return ramp(h);
  }

  if (h < 120) {
    return m2;
  }

  return h < 160 ? ramp(160 - h) : m1;
}

/**
 * A colour from hue, luminosity and saturation (seg1 `29f1`). Grey, with no
 * saturation, is the luminosity times 255 over 240, not rounded; each of the
 * others is rounded.
 */
export function hlsToRgb(h: number, l: number, s: number): number {
  if (s === 0) {
    const v = Math.floor((255 * l) / 240) & 0xff;

    return (v | (v << 8) | (v << 16)) >>> 0;
  }

  const m2 =
    l <= 120
      ? word(Math.floor((l * (240 + s) + 120) / 240))
      : word(l + s - Math.floor((word(l * s) + 120) / 240));
  const m1 = word(l * 2 - m2);
  const byte = (v: number) => Math.floor(word(word(v * 255) + 120) / 240) & 0xff;
  const r = byte(hueToRgb(m1, m2, word(h + 80)));
  const g = byte(hueToRgb(m1, m2, h));
  const b = byte(hueToRgb(m1, m2, word(h - 80)));

  return (r | (g << 8) | (b << 16)) >>> 0;
}
