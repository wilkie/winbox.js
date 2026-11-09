---
kind: function
module: GDI
name: DMExtTextOut
ordinal: 214
summary: Text drawn on a memory bitmap by the display driver's ExtTextOut from a raster font of version 3.0, with the emboldening and italics the display can make taken off where the device drawn for cannot.
versions:
  '3.1': partial
probes: [gdidmdrw, prttstk, prttcw]
records: [text, emboldened]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMExtTextOut(lpDestDev, DestX, DestY, lpClipRect, lpString, wCount, lpFontInfo, lpDrawMode, lpTextXForm, lpCharWidths, lpOpaqueRect, wOptions)` takes 40 bytes of arguments, as the display driver's `ExtTextOut` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 34h in DX.
- [[measured]] [[probe:gdidmdrw]], a font laid out as GDI loads one -- the file's header at nought of its segment, version 3.0, its `FONTINFO` at 42h: the string is drawn at the point given, its top there, and nought is answered.
- [[measured]] Each glyph's set bits are the text colour; where the background is opaque, the rest of the string's cell -- the font's height, and across as far as the farthest glyph or advance reaches -- is the background colour. Glyphs that overlap are both drawn.
- [[measured]] Each character moves the next on by its width, or by the width given for it but the last, then the character extra; the break character by the break extra too, and by one more each time the break error, less the remainder, falls to nought, the count then added back. A character outside the font is the default one.
- [[measured]] The clipping rectangle bounds the string. With `ETO_CLIPPED` it is cut to the opaque rectangle, and nothing at all is drawn where they do not meet. With `ETO_OPAQUE` the opaque rectangle is filled with the background colour inside the clip first.
- [[measured]] A `TEXTXFORM` of weight 700 or more on a lighter font emboldens: each glyph set again a pixel to the right, and each character a pixel wider.
- [[measured]] A negative count answers the extent: its height in the high word, the widths with the extras in the low.
- [[measured]] The Super VGA's and the EGA's drivers give every record the VGA's.

- [[measured]] [[probe:prttstk]]: a printer's driver whose `dpText` is nought draws `AW` with it through a `TEXTXFORM` of 700 and `TC_EA_DOUBLE`. After text on a memory context of the display's the string is emboldened; after text on the printer's context, or the printer's `GetTextExtent` of a font its driver realized, it is the plain string, and the `TEXTXFORM` is as it was given after the call. A `TEXTXFORM` of 700 without `TC_EA_DOUBLE` is emboldened after either. A font realized for the printer's context, after the display's text, leaves it emboldened.
- [[measured]] [[probe:prttcw]]: after the printer's `GetCharWidth` -- a range of one or more, of a font realized already or one its widths realize -- the plain string; after the display's memory context's, emboldened again. A range that runs backwards answers nought and leaves it as it was.
- [[measured]] On the 256-colour display a font of 3.0 is drawn as the VGA draws it, the colours' indices a byte a pixel, but never emboldened: the bold string is the plain one, and its extent no wider.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0000`: before the call, `DMExtTextOut` looks at the `TEXTXFORM`'s word at 0Fh (seg13 `0011`-`0072`). Where it has `TC_EA_DOUBLE` (200h), the display's `GDIINFO` has it in `dpText` (22h) and the `GDIINFO` of GDI's `[063Eh]` has not, the weight at 8 is made 400 and the bit cleared; likewise for `TC_IA_ABLE` (400h), the italic byte at 0Ah made nought. Each is put back after the call (`00b9`-`00d4`). Then it calls `Brute` with its own arguments by a near call to `012a`, `mov cx,3418h`, CH the offset 34h of `ExtTextOut` in the display driver's table.

[[read out]] `[063Eh]` is the `GDIINFO` of the device context GDI is drawing text for: GDI sets it to the context's device information (its word 32h) as it draws text (seg1 `31d8`, `ExtTextOut`, which `TextOut` is, for any context but a metafile's), as it measures text (seg1 `3bd8`, `GetTextExtent` with a font that is not one its TrueType engine realized itself -- `3cb4` takes those elsewhere -- and a string not empty), and as it is asked a font's widths, `GetCharWidth` on a device whose `dpRaster` has `RC_GDI20_OUTPUT` (seg3 `20bd`-`20c4`, before the font is realized) -- [[measured]] not where a font is realized for the driver by anything else. Inside a printer driver's `ExtTextOut` it is the printer's: the display's emboldening and italics are taken off where the printer could not have made them, GDI having made them already. It starts nought, which no program reaches: USER's drawing makes it the display's first. The display's `dpText` is that of the screen's context, GDI's `[0012h]` (seg13 `002e`-`0034`): on the VGA 2204h, `TC_EA_DOUBLE` without `TC_IA_ABLE`, so the italics are never taken off there.

[[read out]] `VGA.DRV` seg1 `0000` jumps to the 386's `ExtTextOut`, seg2 `0837`. It takes only a font at offset 42h of a segment whose word nought is 300h (seg2 `099b`-`09a7`); any other answers AX nought and DX 8000h (`089b`). The emboldening at `0862`-`087a`; the `DRAWMODE` read at `0927`; the clip and opaque rectangles at `09f2`; the extent at `0b5a`, the break characters at `0bd1`; the characters' places, where widths are given or an extra is below nought, at `0c4b`.

[[read out]] `SVGA256.DRV` seg2 `0375` (`StrBlt` at `036a` pushes five words of nought): a font whose `FONTINFO` is not at 42h or not of 3.0 answers 80000000h (`049b`, `03c7`); a negative count the extent (`083a`); the clip cut to the opaque rectangle (`04f4`). No weight is read.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

The emboldening and italics taken off as read out (`DMExtTextOut` in `taken_off` in `crates/winbox-win16/src/gdi/driver_helpers.rs`), `[063Eh]` kept as the last text context's `dpText` (`noteTextDevice`, `note_text_device`; `GetCharWidth`'s through `note_char_width_device`). `crates/winbox-win16/src/gdi/driver_bitmap.rs` on the VGA, the Super VGA and the EGA: the characters laid out as `0c4b` lays them, the glyphs gathered into the string's cell and drawn through the clip. [[probe:gdidmdrw]] agrees on the three.

On the 256-colour display its own (`crates/winbox-win16/src/gdi/driver_vga256.rs`), [[probe:gdidmdrw]] agreeing.

## Not yet done

- The Hercules's drawing of a font of 2.0, which WinBox answers as it answers a font of 3.0.
