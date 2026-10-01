---
kind: topic
name: Palettes on a display of fixed colours
summary: What Windows 3.1's palette calls answer, and what a colour given as a palette index draws as, on displays whose colours cannot change — the VGA, the EGA, the Super VGA and the Hercules.
probes: [palette, dibpal, palsys, palreal, paldib]
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

## A display with a palette

Windows can be recorded on one: Microsoft's Super VGA 256-colour driver, `SVGA256.DRV`, on the Tseng ET4000 that DOSBox emulates. [[fn:GDI.GetDeviceCaps]] there answers 8 bits a pixel, `RC_PALETTE`, a palette of 256 with 20 reserved, and `NUMCOLORS` 20. [[probe:palsys]] reads the system palette before any program has realized one, and draws colours given as RGB.

- [[measured]] The twenty static colours are at both ends of the system palette: the stock palette's first ten at 0 to 9, and its last ten at 246 to 255.
- [[measured]] The 236 entries between are the driver's own: a cube of red, then green, then blue, each over `3f`, `5f`, `7f`, `9f`, `bf`, `df` and `ff`, starting a step in. Entry 10 is `5f3f3f`, and entry 245 is `dfdfbf`.
- [[measured]] A colour given as RGB is drawn as the nearest of the twenty static colours by the sum of the squares, the lower index on a tie. That holds for [[fn:GDI.SetPixel]], [[fn:GDI.GetPixel]] and [[fn:GDI.GetNearestColor]] alike. `7f7f7f` is drawn `808080`, and `ff8000`, as near `808000` as `ffff00`, is drawn `808000`. The driver's own entries are never matched, even when the colour is exactly one: `5f3f3f` is drawn `800000`.
- [[measured]] A solid brush of a static colour is solid. Any other colour is dithered as the sixteen-colour VGA dithers it, each of the VGA's colours drawn as the static entry that holds it: `ff8000` is a checker of red and yellow.
- winbox.js's `vga256` display is this driver, and agrees with all of `palsys`'s records.

## Realizing a palette there

[[probe:palreal]] realizes a palette of eight entries in the foreground of an active window on the 256-colour display, then a second palette of four in the background, then animates. [[probe:paldib]] draws DIBs and WinG bitmaps with a palette realized. winbox.js agrees with all their records.

- [[measured]] Realized in the foreground, a palette's colours take the slots between the static colours in order from 10, whatever was there. The driver's own `5f3f3f`, already at 10, is put at 12 when it comes third. A colour that is one of the static colours, `ff0000`, is drawn as that, and takes no slot. A colour the palette has already had shares its slot. `PC_NOCOLLAPSE` and `PC_RESERVED` entries take slots of their own.
- [[measured]] [[fn:USER.RealizePalette]] answers the palette's count of entries: 8, then 4 for the second. Realizing the same palette again answers 0. After [[fn:GDI.UnrealizeObject]] it answers 8 again, into the same slots.
- [[measured]] Realized in the background, with `SelectPalette`'s last argument TRUE, a palette's colours take the free slots after the foreground's, 16 to 19, and leave the foreground's alone.
- [[measured]] With the palette selected, `PALETTEINDEX(n)` draws in entry `n`'s slot, and in entry 0's past the palette's end. `PALETTERGB` draws in its nearest entry's slot. [[fn:GDI.GetPixel]] and [[fn:GDI.GetNearestColor]] answer the slot's colour.
- [[measured]] A colour given as plain `RGB` is still drawn as the nearest static colour, even one that is now in a slot: `RGB(12h, 34h, 56h)` is navy.
- [[measured]] A DIB's colours, drawn with [[fn:GDI.SetDIBitsToDevice]] and `DIB_RGB_COLORS`, and a WinG bitmap's, blitted, are drawn in the slots of the realized palette's nearest entries: `808080` comes out `5f3f3f`, the palette's nearest, not the static grey. With `DIB_PAL_COLORS` the colour table is indices into the realized palette, and an index past its end is entry 0.
- [[measured]] [[fn:GDI.AnimatePalette]] changes a `PC_RESERVED` entry's slot in place: a pixel drawn in it before reads back in the new colour.
- [[measured]] The top-level windows are sent `WM_PALETTECHANGED` when a realization changes a slot's colour: twice in `palreal`, for the foreground palette and the background one, and not when the first is realized again into the slots it had.
- [[measured]] [[fn:GDI.GetSystemPaletteUse]] answers 1, `SYSPAL_STATIC`, and [[fn:GDI.SetSystemPaletteUse]] answers the use before it. What `SYSPAL_NOSTATIC` does to the static colours is not followed.
- A pen of a palette's colour draws in its slot too. SimTower frames its dialog with such pens, and Windows' screen shows them in the palette's greys. That is from the corpus, not a probe.
- SimTower realizes its palette and draws its title as one DIB. With all this, its title screen differs from Windows' only by the mouse cursor and a focus rectangle.

## Not yet followed

- `SYSPAL_NOSTATIC`, `RealizeDefaultPalette` and `UpdateColors` on the 256-colour display. The `palette` probe's own recording there is not kept: the entries a resized palette gains are whatever memory held, and on a palette device they are realized and drawn.
- `PALETTEINDEX` colours in pens, text, and the brushes of `Rectangle`, `Ellipse` and `Polygon`.
- `AnimatePalette`, `UpdateColors`, `RealizeDefaultPalette`, and palettes in DIBs.

## In winbox.js

`src/win16/gdi/palettes.ts`, and `src/raster/palette-colour.ts` for what a colour given as a palette index draws as.
