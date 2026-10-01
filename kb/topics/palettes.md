---
kind: topic
name: Palettes on a display of fixed colours
summary: What Windows 3.1's palette calls answer, and what a colour given as a palette index draws as, on displays whose colours cannot change — the VGA, the EGA, the Super VGA and the Hercules.
probes: [palette, dibpal]
---

A program that shows pictures of many colours makes a **logical palette**, selects it into a device context and realizes it. On a display with a palette of its own, that changes the colours the screen can show. None of the four displays winbox.js records have one. [[fn:GDI.GetDeviceCaps]] answers no `RC_PALETTE` and a palette size of 0, so the calls do less, and what they answer is what a program has to cope with. Windows Help makes a palette as it starts.

[[measured]] [[probe:palette]] makes a palette of four entries and reads it back, changes it, resizes it, and matches colours against it. It selects and realizes it, draws pixels in colours given as palette indices, and asks about the system palette. It does this on all four displays, and winbox.js agrees with every record: 38 on each.

## A logical palette

- [[measured]] [[fn:GDI.CreatePalette]] keeps the entries as they were given, flags and all. [[fn:GDI.GetObject]] answers a palette's count of entries, in a word.
- [[measured]] [[fn:GDI.GetPaletteEntries]] and [[fn:GDI.SetPaletteEntries]] answer how many entries they read or wrote, stopping at the palette's end: two of six asked for from entry 2 of four.
- [[measured]] [[fn:GDI.ResizePalette]] answers 1. The entries it adds are whatever memory held, the same leftovers on every display, and are not recorded.
- [[measured]] [[fn:GDI.GetNearestPaletteIndex]] answers the entry nearest in red, green and blue, squared, the first of equals.
- [[measured]] The stock `DEFAULT_PALETTE` has twenty entries: the sixteen colours, eight each side of four more, `C0DCC0`, `A6CAF0`, `FFFBF0` and `A0A0A4`. They are the same on every display.

## Selecting and realizing

- [[measured]] [[fn:USER.SelectPalette]] answers the palette the device context had, the stock one to begin with. [[fn:USER.RealizePalette]] answers 0: there is nothing to realize.
- [[measured]] A realized palette changes nothing about how a DIB's colours become the display's. [[probe:dibpal]] makes a 256-colour DIB with [[fn:GDI.CreateDIBitmap]] twice: with a logical palette of the DIB's own colours selected and realized, as Championship Slots of the corpus makes its pictures, and without. All 256 colours come out the same both ways, by the display driver's rule ([[fn:GDI.GetNearestColor]]). RealizePalette answers 0.
- [[measured]] [[fn:GDI.GetSystemPaletteEntries]] answers the display's own colours, as many as it has, with flags 0: sixteen, in the order of its bitmaps' indices ([[fn:GDI.BitBlt]]), with the EGA's own grey at 8; or the Hercules's two.
- [[measured]] [[fn:GDI.GetSystemPaletteUse]] and [[fn:GDI.SetSystemPaletteUse]] answer 0.

## Colours given as palette indices

- [[measured]] `PALETTEINDEX(n)`, given to `SetPixel` or to a solid brush, is entry `n` of the palette selected into the device context it draws in, drawn as the display's nearest colour. It is the stock palette's entry if none is selected, and entry 0 for an index past the palette's end. A brush's colour is looked up where it is used, not where it was made.
- [[measured]] An entry with `PC_EXPLICIT` is the display's own colour that the entry's low word names: `01 02 03` draws as the VGA's colour 1, dark red. On the Hercules it draws black, the entry's own colour. winbox.js follows that for a display of two colours, fitted to that one case.
- [[measured]] `PALETTERGB` draws as the colour itself, as a plain `RGB`.

## Not yet followed

- A display with a palette of its own. Windows can now be recorded on one, Microsoft's Super VGA 256-colour driver on an ET4000, and its device capabilities agree with winbox.js's `vga256` mode. The palette calls on it are not followed yet: there, `RealizePalette` on the screen answers 6, `GetSystemPaletteUse` and `SetSystemPaletteUse` answer, and the system palette is not a fixed table.
- `PALETTEINDEX` colours in pens, text, and the brushes of `Rectangle`, `Ellipse` and `Polygon`.
- `AnimatePalette`, `UpdateColors`, `RealizeDefaultPalette`, and palettes in DIBs.

## In winbox.js

`src/win16/gdi/palettes.ts`, and `src/raster/palette-colour.ts` for what a colour given as a palette index draws as.
