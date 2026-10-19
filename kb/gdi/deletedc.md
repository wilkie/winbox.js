---
kind: function
module: GDI
name: DeleteDC
ordinal: 68
summary: Deletes a device context; the last on a printer's device has the driver's Disable called, the last on a driver lets the library go, and then the device's PDEVICE and what was realized for it are freed.
versions:
  '3.1': partial
probes: [pric, prdlg, prdrv]
source: src/win16/gdi/DeleteDC.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:pric]]: each of three ICs of the PostScript driver answered 1; one deleted twice answered nought.
- [[measured]] [[probe:prdrv]], with a driver of the probe's own: the fonts the driver realized are still there as its `Disable` is called and as the library is freed; they are gone after. Of two contexts sharing a device, deleting the first calls nothing of the driver's and frees nothing it realized.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `082e`: the device's count of contexts taken down, and at nought the driver's `Disable` given the `PDEVICE` (`0906`), and the device taken from the driver's list; the driver's count taken down, and at nought `FreeLibrary` (`0947`). Then, where the device went, its `PDEVICE` is freed (`09dd`), and what was realized for it: its pens and brushes (`09ea`, seg1 `4460`) and its fonts (`09ef`, seg6 `0387`), each `FONTINFO` given to `EngineDeleteFont` and freed, the driver not called. See [[topic:printer-drivers]].

## Implementation

`deleteDriverDC` in `src/win16/gdi/printer-driver.ts`, `delete_driver_dc` in the Rust engine.
