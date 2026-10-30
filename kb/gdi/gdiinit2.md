---
kind: function
module: GDI
name: GDIInit2
ordinal: 403
summary: Reads or sets the word at 0Ah of a GDI object -- a bitmap's block of bits -- as WinG does to put its own memory under a bitmap. Not start-up, whatever the name.
versions:
  '3.1': stub
source: src/win16/gdi.ts
topics: [gdi-internals]
---

## Inside Windows

[[read out]] `GDI.EXE` seg2 `042a`: `GDIInit2(hObject, wValue)`. The handle is a local handle in GDI's heap; the word at 0Ah of the object it names is answered for a value of nought, made nought for -1 (AX is then GDI's data segment), and set to the value, which is answered, otherwise. `retf 4`. For a bitmap that word is the global handle of the driver's header and bits ([[topic:gdi-objects]]).

## Callers

[[read out]] `WING.DLL` imports it. No other file does.

## Implementation

A stub in both engines.

**Recommendation: not needed.** WinBox's WinG is its own module (`wing.ts`), which keeps a WinG bitmap's bits itself; Windows' `WING.DLL` is not loaded. Reading the word would be WinBox's GDI heap's (`gdi-heap.ts`), and setting it can change nothing WinBox draws.
