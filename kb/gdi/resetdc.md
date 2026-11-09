---
kind: function
module: GDI
name: ResetDC
ordinal: 376
summary: Updates a printer's device context for a new DEVMODE; nought for the display's.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals, printing]
---

## Observed behaviour

- [[measured]] A memory device context's, a window's and the screen's answer nought ([[probe:dcinner]]).

## Inside Windows

[[read out]] `GDI.EXE` seg31 `009c` checks the arguments, and seg31 `0372` does the rest:

- A metafile's context records the call (seg20 `2596`).
- A context in a document's page (byte 0Bh, bit 5) answers nought, and so does one whose device is a raster display (`GDIINFO`'s technology 1) or whose driver does not answer `QUERYESCSUPPORT` for `RESETDEVICE` (128).
- Otherwise a new context is made for the same driver, device and port, the `DEVMODE` given (seg1 `480a`); the driver's `RESETDEVICE` is given the old context's device; the two contexts' first CEh bytes are exchanged, but for byte 3; and the new handle, now holding the old context, is deleted. The answer is the context's own handle.

## Implementation

Nought: for the display's contexts as Windows answers, and for WinBox's own printer, which answers no `QUERYESCSUPPORT`. A Windows printer driver's from the drive is not followed and answers nought too ([[topic:device-context-internals]]). [[probe:dcinner]] agrees in both.
