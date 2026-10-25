---
kind: function
module: GDI
name: GDIRealizePalette
ordinal: 362
summary: GDI's half of RealizePalette: realizes a device context's palette into the system palette, answering the entries moved and the slots given a colour.
versions:
  '3.1': exact
probes: [dcinner, palreal]
topics: [palettes]
---

## Observed behaviour

- [[measured]] On a display of fixed colours it answers nought ([[probe:dcinner]]).
- [[measured]] On the 256-colour display, the first realization of a palette of four in the foreground answers 40004h: four entries in new slots, and four slots given a colour. Again, nought. A memory context's palette is realized as any other's.

## Inside Windows

[[read out]] `GDI.EXE` seg22 `1088`: nought where the device has no `RC_PALETTE`, or where the context's palette is the one realized last (`[482h]`). It becomes that; the stock palette is realized as such, GDI's foreground palette (`[480h]`) in the foreground and any other in the background, by seg22 `0cfb`. That answers in AX the entries whose slot changed and in DX the slots it gave a colour, and sends the driver the palette where any did.

USER's [[fn:USER.RealizePalette]] (`USER.EXE` seg6 `0134`) answers AX; where DX is not nought and the palette is GDI's foreground palette, it sends `WM_PALETTECHANGED` to every window with the context's and realizes again.

## Implementation

In both engines as read out, on the system palette WinBox keeps ([[topic:palettes]]). A palette realized before keeps its slots in the foreground, as seg22 `0dd2` keeps them. [[probe:dcinner]] and [[probe:palreal]] agree in both.
