'use strict';

/**
 * A palette's colours as the screen shows them: its entries, but where the
 * display driver puts another colour in the DAC -- the Super VGA 256-colour
 * driver writes a component of exactly 80h of its first ten entries as C0h
 * (`brightLowStatics`, read out of SVGA256.DRV and recorded by `palshot`).
 * What a program reads back is the entries; this is only for showing them.
 */
export function shownColours(
  display: any,
  colours: [number, number, number][]
): [number, number, number][] {
  const below: number = display?.brightLowStatics ?? 0;

  if (!below) {
    return colours;
  }

  const brighten = (value: number) => (value === 0x80 ? 0xc0 : value);

  return colours.map(([red, green, blue], index) =>
    index < below ? [brighten(red), brighten(green), brighten(blue)] : [red, green, blue]
  );
}
