---
kind: function
module: GDI
name: GDISeeGDIDo
ordinal: 452
summary: A debugging door into GDI's heap -- allocate, free or compact in it, or ask its segment -- that nothing in Windows 3.1 uses.
versions:
  '3.1': stub
source: src/win16/gdi.ts
topics: [gdi-internals]
---

## Inside Windows

[[read out]] `GDI.EXE` seg21 `19a0`: `GDISeeGDIDo(wRequest, wParam1, wParam2, wParam3)` answers a long. Request 1 is `LocalAlloc(wParam1, wParam3)` in GDI's heap, 2 `LocalFree(wParam1)`, 3 `LocalCompact(wParam3)`, each answered with nought in the high word; 103h answers GDI's data segment; any other -1. `retf 8`.

## Callers

[[read out]] None imports it, and TOOLHELP does not ask for it by number.

## Implementation

A stub in both engines.

**Recommendation: not needed.** WinBox's GDI has no local heap of its own ([[fn:GDI.ShrinkGDIHeap]]).
