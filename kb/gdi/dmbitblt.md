---
kind: function
module: GDI
name: DMBitBlt
ordinal: 201
summary: A printer's driver's block transfer on a memory bitmap, handed to the display driver's BitBlt; the one helper whose source is a device too.
versions:
  '3.1': partial
probes: [gdidmdrw]
records: [blt]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[read out]] `DMBitBlt(lpDestDev, DestX, DestY, lpSrcDev, SrcX, SrcY, Xext, Yext, Rop3, lpPBrush, lpDrawMode)` takes 32 bytes of arguments, as the display driver's `BitBlt` does. For a device that is not a memory bitmap -- its first word not nought -- nothing is drawn and the answer is GDI's data segment in AX and 00h in DX.
- [[measured]] [[probe:gdidmdrw]], on a bitmap of 32 by 8 of the display's format and on a monochrome one: every pixel of the rectangle is the raster operation's table applied to the brush's bit, the source's and its own, plane by plane -- the fifteen named operations and two others, each exact. The answer is 1.
- [[measured]] The brush's pixel is its pattern's at x and y modulo eight of the destination. A brush realized from a monochrome pattern is drawn in the `DRAWMODE`'s colours, a set bit the background colour and a clear one the text colour. A hatched brush draws its background whether the `DRAWMODE`'s background is opaque or not.
- [[measured]] A monochrome source onto a colour bitmap: white as the background colour, black as the text colour. A colour source onto a monochrome bitmap: white where it is the background colour.
- [[measured]] Nothing is clipped. A blit four pixels past the right-hand edge of the last rows went on into the next plane's row, and past the last row into the bytes after the bitmap.
- [[measured]] A copy within one bitmap, overlapping either way, is the source as it was before the copy.
- [[measured]] The Super VGA's driver gives every record the VGA's, and the EGA's too.

- [[measured]] On the 256-colour display a byte a pixel is combined bit by bit; the rectangle is cut to the source's bitmap, and a hollow brush where the operation reads one answers nought. A monochrome copy of a bitmap onto itself to the right and down comes out shifted the wrong way between bytes, as the driver's code going back has it.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `014a`: `mov cx,0014h`, CL the words `Brute` moves and CH the offset 00h of `BitBlt` in the display driver's table. It is one of the five-byte entries of `GDI.EXE` seg13 that load CX and jump to [[fn:GDI.Brute]] (seg13 `0171`): for a memory bitmap, the display driver's own routine of the same offset is called with the same arguments; for any other device nothing is called and the answer is GDI's data segment in AX with the routine's offset in DX.

[[read out]] Of all the helpers only this one looks at a second device: with an offset of nought, `Brute` takes the source too (`01b2`-`01c0`), and for a source that is a memory bitmap sets its `bmlpPDevice` for the call and puts it back after (`01ce`-`01e6`). A source of nought is left alone. The driver called is the last device's: a bitmap source makes it the display's whatever the destination.

[[read out]] `VGA.DRV` exports `BitBlt` as ordinal 1 at seg1 `0466`; the physical brush it reads is its `RealizeObject`'s ([[fn:GDI.DMRealizeObject]]): four planes of eight rows at 00h, the monochrome plane at 20h, the style at 28h.

[[read out]] `SVGA256.DRV` seg1 `16a0`, a blit compiled for each call: an operation whose high byte is not nought answers nought; each bitmap must be of the word 801h at 8, a byte a pixel, or 101h (`1fb8`); whether the operation reads its source and its brush is a table at `1316`, which is its truth table's; the source's rectangle is cut to its bitmap, moving the destination with it (`1784`-`17ca`); the brush is copied as `1eb1` takes it -- a hollow brush fails, a monochrome pattern takes the background colour where set and the text colour where not; a source of the other format is white as the background colour, or white where it is the background colour (`1f9e`). A copy within one bitmap whose rectangles overlap goes from the end back (`1816`-`1862`) through code made for going forward (`0a2c`, `0a95`-`0abe`): a monochrome copy keeps the forward masks and joins each byte to the one before it in the walk.

## Callers

[[read out]] `PSCRIPT.DRV` imports it by ordinal. No program of the corpus does.

## Implementation

On the 256-colour display its own (`driver-vga256.ts`, `driver_vga256.rs`), [[probe:gdidmdrw]] agreeing.

`driver-bitmap.ts` and `driver_bitmap.rs`, through `Brute`'s choice (`driver-helpers.ts`, `driver_helpers.rs`): on the VGA, the Super VGA and the EGA, the bitmap's pixels read and written in the program's memory as the driver addresses them, with no bound, and combined by GDI's own `combine` (`raster-op.ts`). [[probe:gdidmdrw]] agrees in both engines on the three.

## Not yet done

- On the 256-colour display, a monochrome copy going back whose source is further into its byte than the destination, which the driver fetches once more first (`18fb`-`190d`, `0abf`): no probe records one.
