---
kind: function
module: GDI
name: GDIInit2
ordinal: 403
summary: Reads or sets the word at 0Ah of a GDI object -- a bitmap's block of bits -- as WinG does to put its own memory under a bitmap. Not start-up, whatever the name.
versions:
  '3.1': exact
probes: [ugaps]
records: [gdiinit2]
source: src/win16/gdi/system-exports.ts
topics: [gdi-internals]
---

## Observed behaviour

- [[measured]] [[probe:ugaps]] on a bitmap of the display's: nought answers the word at 0Ah of its object, the handle of its driver block, as read through GDI's heap; 1234h sets it and answers it, and a read then answers 1234h; FFFFh makes it nought and answers GDI's data segment; DX kept, four bytes popped.

## Inside Windows

[[read out]] `GDI.EXE` seg2 `042a`: `GDIInit2(hObject, wValue)`. The handle is a local handle in GDI's heap; the word at 0Ah of the object it names is answered for a value of nought, made nought for -1 (AX is then GDI's data segment), and set to the value, which is answered, otherwise. `retf 4`. For a bitmap that word is the global handle of the driver's header and bits ([[topic:gdi-objects]]).

## Callers

[[read out]] `WING.DLL` imports it. No other file does.

## Implementation

**Implemented (a).** Both engines read the object's address at the handle in GDI's heap as WinBox lays it out (`gdi-heap.ts`, `gdi/heap.rs`) and read or set its word 0Ah, a word set kept in the heap until the object is deleted (`GDIInit2` in `src/win16/gdi/system-exports.ts`). Setting it changes nothing WinBox draws. See [[topic:gdi-internals]].
