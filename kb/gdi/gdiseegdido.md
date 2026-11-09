---
kind: function
module: GDI
name: GDISeeGDIDo
ordinal: 452
summary: A debugging door into GDI's heap -- allocate, free or compact in it, or ask its segment -- that nothing in Windows 3.1 uses.
versions:
  '3.1': partial
probes: [ugaps]
records: [seegdi, seegdiheap]
source: crates/winbox-win16/src/gdi/system_exports.rs
topics: [gdi-internals]
---

## Observed behaviour

- [[measured]] [[probe:ugaps]]: 103h answers GDI's data segment, DX nought; 7, nought and 102h answer FFFFFFFFh; 1 of a fixed block of 10h bytes answers a block, 2 of it nought, 3 a size, DX nought each.

## Inside Windows

[[read out]] `GDI.EXE` seg21 `19a0`: `GDISeeGDIDo(wRequest, wParam1, wParam2, wParam3)` answers a long. Request 1 is `LocalAlloc(wParam1, wParam3)` in GDI's heap, 2 `LocalFree(wParam1)`, 3 `LocalCompact(wParam3)`, each answered with nought in the high word; 103h answers GDI's data segment; any other -1. `retf 8`.

## Callers

[[read out]] None imports it, and TOOLHELP does not ask for it by number.

## Implementation

**Implemented (a).** Both engines answer the requests as GDI does (`GDISeeGDIDo` in `src/win16/gdi/system-exports.ts`), the heap's requests on GDI's data segment as USER's [[fn:USER.UserSeeUserDo]] answers its own.

## Not yet done

- 1, 2 and 3 (`ugaps:seegdiheap`, a known gap): WinBox's GDI segment holds no local heap ([[fn:GDI.ShrinkGDIHeap]]), so they answer as for a segment with none: nought, the handle, nought.
