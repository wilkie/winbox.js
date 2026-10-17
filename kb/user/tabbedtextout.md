---
kind: function
module: USER
name: TabbedTextOut
ordinal: 196
summary: Draws a line of text with its tabs expanded to stops — every eight average characters, one distance repeated, or a list — counted from a tab origin; GetTabbedTextExtent measures the same.
versions:
  '3.1': exact
probes: [tabtext, prtabs, prnote]
source: src/win16/user/tabbed-text.ts
topics: [text-justification, printer-drivers]
---

## Observed behaviour

[[probe:tabtext]] draws tabbed text in the System font on the VGA's screen and reads it back, with [[fn:USER.GetTabbedTextExtent]] asked the same. [[measured]]

- With no stops, there is one every eight average characters: 64 pixels, the same average [[fn:USER.DrawText]] counts its tabs in. "a\tbb\tccc" puts its pieces at 0, 64 and 128.
- With one stop, its distance repeats: 40 puts them at 0, 40 and 80.
- With several, a tab goes to the first stop past where the text has got to. Past the last, it goes to the next of the default stops: stops of 10, 50 and 90 put "a\tb\tc\td\te" at 0, 10, 50, 90 and 128.
- The stops count from the tab origin, not from where the text starts. The same text at 30, with an origin of 20 and a stop of 40, puts its pieces at 30, 60 and 100.
- Both answer the width from where the text starts to where it ends, in the low word, and the font's height, 16, in the high word. `GetTabbedTextExtent` measures from nought, with an origin of nought.

winbox.js agrees with all 68 records of these cases. Both were stubs.

## Nuances

- Not recorded: another font's default stops, which winbox.js takes from `tmAveCharWidth` as `DrawText` does; and how the background between the pieces is painted in `OPAQUE` mode. winbox.js paints only the pieces' own.

## Inside Windows

[[read out]] `USER.EXE` seg6 `1f1d` checks the DC and the pointers, then goes to the body at seg6 `0992`:

1. **Opaque** where the background mode is `OPAQUE`. No string, or a count of nought, answers nought.
2. **The average and the height.** Where seg1 `9c1c` finds the DC with the System font, they are USER's own (`[0522h]`, `[052Ah]`). Otherwise the average is seg2 `0410`'s: `tmAveCharWidth` for a fixed pitch, and for a variable one the extent of the 26 small and 26 capital letters, over 26, plus one, halved (seg2 `03a4`). The height is the high word of [[fn:GDI.GetTextExtent]] of "0".
3. **The tab distance** is eight averages with no stops, and the one stop's with one, 1 where that is nought. There is none with several.
4. **Each run up to a tab** is measured with `GetTextExtent` and drawn with GDI's [[fn:GDI.ExtTextOut]] at the pen, `ETO_OPAQUE` where the mode is opaque. Its rectangle runs from where the last run ended to where this one ends, and from the line's top down by the height, so the gap a tab leaves is painted with the run after it.
5. **A tab** moves the pen to the next multiple of the distance past the run's end, counted from the origin; the division is unsigned. With several stops it moves to the first stop past the run's end. Past the last stop it moves to the next stop of eight averages, and that distance then serves every tab after it.
6. **A tab that ends the string** has its gap painted with an empty `ExtTextOut`, `ETO_OPAQUE` whatever the background mode.
7. The answer is the width from the start to the last run's end, with the height above it.

[[measured]] [[probe:prtabs]] has it draw through the PostScript driver: no stops, one, one of nought, several with tabs past the last, opaque on grey, a tab at the end, and a font of variable pitch. Every run is an `ExtTextOut` of its own, and the tab at the end of a transparent line still paints its gap white. Both engines agree with all 88 records. [[probe:prnote]]: Notepad prints each line with it, its tabs already turned to spaces.

## Implementation

On a printer driver's context it goes as USER goes, through the driver's `ExtTextOut` and extent: `driverTabbedTextOut` in `src/win16/user/tabbed-text.ts` and `driver_tabbed_text_out` in `crates/winbox-win16/src/draw_text.rs`. Any other context is drawn as before, a piece at a time with `TextOut`.

## Not yet done

- The read-out's opaque rectangles on the screen. There `OPAQUE` still paints only the pieces' own grounds.
- `GetTabbedTextExtent`, `DrawText` and `GrayString` on a printer driver's context. Their measures there do not reach the driver.
