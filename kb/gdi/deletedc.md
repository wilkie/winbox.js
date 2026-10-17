---
kind: function
module: GDI
name: DeleteDC
ordinal: 68
summary: Deletes a device context; the last on a printer's device has the driver's Disable called and its PDEVICE freed, and the last on a driver lets the library go.
versions:
  '3.1': partial
probes: [pric, prdlg]
source: src/win16/gdi/DeleteDC.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] [[probe:pric]]: each of three ICs of the PostScript driver answered 1; one deleted twice answered nought.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `082e`: the device's count of contexts taken down, and at nought the driver's `Disable` given the `PDEVICE` (`0906`), which is freed, and the device taken from the driver's list; the driver's count taken down, and at nought `FreeLibrary` (`0947`). See [[topic:printer-drivers]].

## Implementation

`deleteDriverDC` in `src/win16/gdi/printer-driver.ts`, `delete_driver_dc` in the Rust engine.
