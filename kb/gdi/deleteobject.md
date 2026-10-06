---
kind: function
module: GDI
name: DeleteObject
ordinal: 69
summary: Deletes a pen, brush, font, bitmap, region or palette and answers 1 — but a stock object is never deleted, and still answers 1; an object selected into a device context is deleted all the same.
versions:
  '3.1': exact
probes: [stockdel, gdinum]
source: src/win16/gdi/DeleteObject.ts
topics: [gdi-objects]
---

## Observed behaviour

[[measured]] [[probe:stockdel]] deletes every stock object, the bitmap a memory device context starts with, and objects still selected into a device context. It was recorded on the VGA, the Super VGA, the EGA and the Hercules, and all four agree.

- **A stock object is not deleted.** For each of the seventeen, from `WHITE_BRUSH` to `SYSTEM_FIXED_FONT` and `DEFAULT_PALETTE` included, `DeleteObject` answers 1. A second delete answers 1 again. [[fn:GDI.GetStockObject]] still answers the same handle, [[fn:GDI.GetObject]] still tells of it as before, and it can still be selected. A brush made afterwards does not get a stock object's handle.
- **The stock bitmap** behaves the same way. That is the one-by-one monochrome bitmap a new memory device context starts with, which [[fn:GDI.SelectObject]] gives back when another bitmap is selected. Deleting it answers 1, and `GetObject` still tells of it.
- **An object selected into a device context is deleted.** For a pen, a brush, a font and a bitmap, the answer is 1. After it, `GetObject` answers nought, a second delete answers nought, and selecting it into another context answers nought. The context it was in keeps its handle: selecting that context's own object back answers the deleted object's handle.
- A pen deleted twice: 1, then nought.
- `DeleteObject(NULL)` answers nought.

[[read out]] GDI marks each stock object as it makes it at start-up. It sets 8000h in the object's type word, the word at +2 that holds the object's kind (`GDI.EXE` 2:02AE for the brushes, pens and fonts made by the table at 2:028C, and 2:0331 for those made from the display's font files). `DeleteObject` tests that word for 8000h or 2000h before anything else, and answers 1 at once if either is set (1:194C). 2000h is the bit [[fn:GDI.MakeObjectPrivate]] sets and clears (1:0E68). Only then does it take the object out of any metafile recording it and dispatch on its kind (1:1955, table at 1:190A). The bitmap case also refuses the stock bitmap by its handle (1:197F). Nothing there looks at whether the object is selected anywhere.

## Why it matters

Two Notepads give their edit controls the same stock font, `SYSTEM_FIXED_FONT`, and each deletes its font as it ends. Under winbox.js, before this was measured, the first Notepad to end freed the font, and the other could not paint its edit control. A randomised stress test of two Notepads stopped so in about seven runs in ten.

## In winbox.js

Both engines answer 1 for a stock handle or a memory context's first bitmap, and leave the object alone. Every memory context's first bitmap answers one shared handle, as Windows' single stock bitmap does. An object deleted while selected keeps the handle it had for the context that still holds it, and `SelectObject` gives that handle back. `MakeObjectPrivate` is a stub in winbox.js, so no object is private and none is spared for it.
