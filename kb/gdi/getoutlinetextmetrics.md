---
kind: function
module: GDI
name: GetOutlineTextMetrics
ordinal: 308
summary: Fills an OUTLINETEXTMETRIC with the selected TrueType font's metrics — its TEXTMETRIC, its OS/2, hhea, head and post fields scaled to the pixel size, and its four names — or answers how big that is.
versions:
  '3.1': partial
probes: [ttquery, ttqmap]
topics: [truetype-queries]
---

## Observed behaviour

- [[measured]] With no buffer it answers the size: 114 bytes and the four names with their nuls, 179 for Arial ([[probe:ttquery]]). `otmSize` is that rounded up to even, 180.
- [[measured]] With a buffer it copies as much as fits and answers 1: into 40 bytes, the size, the `TEXTMETRIC` and the first panose bytes.
- [[measured]] The `TEXTMETRIC` is `GetTextMetrics`'s: first, last, default and break characters 30, 255, 31 and 32.
- [[measured]] The filler byte after it is whatever GDI's stack held: AAh, 0Ah and nought in one run.
- [[measured]] The panose bytes, `fsSelection`, the caret's slope and the EM square are the font's own. `fsType` is `OS/2`'s, bit 0 set for Courier New, whose `post` says fixed pitch. The italic angle is in tenths of a degree: −164 for Times New Roman Italic, whose `post` says −16.33°.
- [[measured]] Every other size is the font's scaled to the pixel size, `(v × ppem + units ÷ 2) ÷ units` truncated: Arial's descent of −431 at sixteen is −2. Even `otmusMinimumPPEM`, which comes back nought.
- [[measured]] `otmsCapEmHeight` and `otmsXHeight` are half and a quarter of the EM, scaled.
- [[measured]] The names are the family (name 1), the face (4, "Arial Bold"), the style (2) and the full name (3, "Monotype:Arial Bold:Version 1 (Microsoft)").
- [[measured]] A strike answers nought, and so does a device context of nought.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `0876` checks the device context and seg7 `16ed` does the rest:

- The `TEXTMETRIC` comes from `GetTextMetrics`' filler (seg3 `0222`), on GDI's stack. It is 31 bytes, and the copy takes 32, so the filler is the stack's next byte.
- The engine fills 68h bytes (seg36 `004e`, its seg36 `1826` and seg40 `0606`), in font units: the panose bytes and `OS/2`'s `fsSelection` and `fsType`, `hhea`'s caret slope, `post`'s italic angle — whole degrees modulo 360 by ten, plus the fraction by ten, floored — and `head`'s `unitsPerEm`. Then the twenty-five sizes: `OS/2`'s typographic ascent, descent and gap; half and a quarter of the EM; `head`'s box; `hhea`'s ascent, descent and gap; `head`'s `lowestRecPPEM`; `OS/2`'s sub- and superscript sizes and offsets and strikeout; `post`'s underline position and thickness. A fixed pitch in `post` sets bit 0 of `fsType`. Without `OS/2`, `hhea` gives the ascent, descent and gap, `head`'s `macStyle` the selection, and `fsType` is 100h.
- The names are the name table's Microsoft entries for the font's encoding in US English, the first of each winning, asked again in US English where the family or the face was missing.
- GDI scales the twenty-five by the pixel size over the units, the half added before a signed division. The names follow the structure, each UTF-16 code's low byte, cut at its nul, their offsets from the structure's start.
- Under another mapping mode, as far as the size given reaches, the ascent to the Macintosh gap and the sub- and superscripts to the underline are turned into logical units, down but for the box's left and right, which are across (seg1 `18d2`, masks F5Fh and FFFh).

## Implementation

As read out, in both engines ([[topic:truetype-queries]]); the filler byte is written nought. [[probe:ttquery]] shows the filler as `??` and agrees in both. Under a mapping mode the font's own height is taken as pixels, so [[probe:ttqmap]]'s metrics are a larger font's.
