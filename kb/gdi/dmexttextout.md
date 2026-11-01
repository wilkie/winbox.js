---
kind: function
module: GDI
name: DMExtTextOut
ordinal: 214
summary: Text drawn on a memory bitmap by the display driver's ExtTextOut from a raster font of version 3.0, with the emboldening and italics the display can make taken off where the device drawn for cannot.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [text]
source: src/win16/gdi/driver-bitmap.ts
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

- [[measured]] On the 256-colour display a font of 3.0 is drawn as the VGA draws it, the colours' indices a byte a pixel, but never emboldened: the bold string is the plain one, and its extent no wider.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0000`: before the call, `DMExtTextOut` looks at the `TEXTXFORM`'s word at 0Fh (seg13 `0011`-`0072`). Where it has `TC_EA_DOUBLE` (200h), the display's `GDIINFO` has it in `dpText` (22h) and the `GDIINFO` of GDI's `[063Eh]` has not, the weight at 8 is made 400 and the bit cleared; likewise for `TC_IA_ABLE` (400h), the italic byte at 0Ah made nought. Each is put back after the call (`00b9`-`00d4`). Then it calls `Brute` with its own arguments by a near call to `012a`, `mov cx,3418h`, CH the offset 34h of `ExtTextOut` in the display driver's table.

[[read out]] `[063Eh]` is the `GDIINFO` of the device context GDI is drawing text for: GDI sets it to the context's device information (its word 32h) as it draws text (seg1 `31d8`), as it measures text (seg1 `3bd8`), and as it realizes a font for a device of `RC_GDI20_OUTPUT` (seg3 `20c4`). Inside a printer driver's `ExtTextOut` it is the printer's: the display's emboldening and italics are taken off where the printer could not have made them, GDI having made them already.

[[read out]] `VGA.DRV` seg1 `0000` jumps to the 386's `ExtTextOut`, seg2 `0837`. It takes only a font at offset 42h of a segment whose word nought is 300h (seg2 `099b`-`09a7`); any other answers AX nought and DX 8000h (`089b`). The emboldening at `0862`-`087a`; the `DRAWMODE` read at `0927`; the clip and opaque rectangles at `09f2`; the extent at `0b5a`, the break characters at `0bd1`; the characters' places, where widths are given or an extra is below nought, at `0c4b`.

[[read out]] `SVGA256.DRV` seg2 `0375` (`StrBlt` at `036a` pushes five words of nought): a font whose `FONTINFO` is not at 42h or not of 3.0 answers 80000000h (`049b`, `03c7`); a negative count the extent (`083a`); the clip cut to the opaque rectangle (`04f4`). No weight is read.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

`driver-bitmap.ts` and `driver_bitmap.rs` on the VGA, the Super VGA and the EGA: the characters laid out as `0c4b` lays them, the glyphs gathered into the string's cell and drawn through the clip. [[probe:gdidmdrw]] agrees in both engines on the three.

On the 256-colour display its own (`driver-vga256.ts`, `driver_vga256.rs`), [[probe:gdidmdrw]] agreeing.

## Not yet done

- The emboldening and italics taken off for `[063Eh]`, which WinBox does not keep: it follows the `TEXTXFORM` as given.
- The Hercules's drawing of a font of 2.0, which WinBox answers as it answers a font of 3.0.
