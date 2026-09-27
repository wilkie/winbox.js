---
kind: function
module: GDI
name: SetObjectOwner
ordinal: 461
summary: Meant to give a GDI object to another owner; in Windows 3.1 it does nothing at all.
versions:
  '3.1': unrecorded
source: src/win16/gdi/SetObjectOwner.ts
---

## Observed behaviour

- [[read out]] In Windows 3.1's `GDI.EXE` (seg1 `76a2`) it sets up a frame, touches nothing, and returns with `retf 4`, taking its two words, the object and the owner, off the stack. It has no answer: `AX` is left holding GDI's own data segment, from its entry.
- [[read out]] `COMMDLG.DLL` calls it (seg6 `0160`), for an object it keeps and an owner its caller names. It looks it up by ordinal with `GetProcAddress` rather than importing it, and only on Windows 3.10 or later: it compares the version with `30Ah` first.
- [[measured]] Every accessory that loads `COMMDLG.DLL` calls it once as it starts: 16 of the 25.

## Nuances

- [[read out]] Its neighbours: `GDITaskTermination` (460, seg1 `7690`) also does nothing and takes one word. `MakeObjectPrivate` (463, seg1 `0e68`) does act: it sets or clears bit `2000h` in the object's header and answers what the bit was before.

## Implementation

A function that does nothing, with the ordinal's two word arguments. Before, it was a stub, which the trace marked on every one of those 16 accessories.
