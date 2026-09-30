---
kind: function
module: USER
name: TabbedTextOut
ordinal: 196
summary: Draws a line of text with its tabs expanded to stops — every eight average characters, one distance repeated, or a list — counted from a tab origin; GetTabbedTextExtent measures the same.
versions:
  '3.1': exact
probes: [tabtext]
source: src/win16/user/tabbed-text.ts
topics: [text-justification]
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
