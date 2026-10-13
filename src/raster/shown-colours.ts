'use strict';

/**
 * A palette's colours as the screen shows them: its entries, but where the
 * display driver puts another colour in the DAC. What a program reads back is
 * the entries; this is only for showing them.
 *
 * * The Super VGA 256-colour driver writes a component of exactly 80h of its
 *   first ten entries as C0h, whenever they are set (`brightLowStatics`, read
 *   out of SVGA256.DRV and recorded by `palshot`).
 * * The 8514/a's driver puts its twenty static colours into the DAC itself as
 *   it starts, and writes a component of exactly 80h as BFh but in 808080
 *   (`enableStatics`; `8514.DRV` seg1 `2ab7`-`2b26`). Its `SetPalette`
 *   writes what it is given (seg9 `03d4`), and GDI sends it the whole
 *   palette, statics and all, where a realization changes the palette or
 *   `SetSystemPaletteUse` puts the statics back (`GDI.EXE` seg22 `0e51`,
 *   `0fd3`, `0af3`); from then on the statics show as they are
 *   (`rewritten`). At start-up GDI sends only the 236 between (seg22
 *   `06f1`).
 */
export function shownColours(
  display: any,
  colours: [number, number, number][],
  rewritten = false
): [number, number, number][] {
  if (display?.enableStatics && !rewritten) {
    return enabledStatics(colours);
  }

  const below: number = display?.brightLowStatics ?? 0;

  if (!below) {
    return colours;
  }

  const brighten = (value: number) => (value === 0x80 ? 0xc0 : value);

  return colours.map(([red, green, blue], index) =>
    index < below ? [brighten(red), brighten(green), brighten(blue)] : [red, green, blue]
  );
}

/**
 * The twenty static colours as `8514.DRV`'s `Enable` writes them, the first
 * ten and then the last ten, as its routine at seg1 `2ae9` does, compares and
 * all: it holds the value it looks for and the one it writes in a register,
 * 80h and BFh, and on meeting 808080 writes it as it is and from then on looks
 * for 7Fh and writes 80h -- which no static colour after it has.
 */
function enabledStatics(colours: [number, number, number][]): [number, number, number][] {
  const shown = colours.map(([red, green, blue]) => [red, green, blue] as [number, number, number]);
  let [looked, written] = [0x80, 0xbf];

  for (const index of [...Array(10).keys(), ...Array.from({ length: 10 }, (_, at) => 246 + at)]) {
    const colour = shown[index];

    if (!colour) {
      continue;
    }

    if (colour[0] === looked && colour[1] === looked && colour[2] === looked) {
      [looked, written] = [looked - 1, looked];
      continue;
    }

    shown[index] = colour.map((value) => (value === looked ? written : value)) as [
      number,
      number,
      number,
    ];
  }

  return shown;
}
