---
kind: function
module: GDI
name: FinalGDIInit
ordinal: 405
summary: The end of GDI's start-up, called once by USER -- GDI binds USER's and KERNEL's entry points and loads its own tables. Not applicable to WinBox.
versions:
  '3.1': stub
source: src/win16/gdi.ts
topics: [gdi-internals]
---

## Inside Windows

[[read out]] `GDI.EXE` seg2 `012e`, given a handle, `retf 2`. It marks GDI started (`[0153h]`); in enhanced protected mode (`__WINFLAGS` 20h and 1) unlocks the pages of the given object's block; walks a table in its own code of modules and ordinals, finding each with `GetModuleHandle` and `GetProcAddress` and keeping the far pointers in its data (`0172`-`01a8`); loads its resource 1000 of type 10, 200h bytes, into its data at 67Eh (`01aa`-`01f5`); where its flags say so loads strings 69h and 6Ah with USER's `LoadString`; and with flag 2 calls `12da`.

## Callers

[[read out]] `USER.EXE` imports it, from its start-up (seg3 `2627`).

## Implementation

A stub in both engines, popping its word.

**Recommendation: not applicable.** WinBox's GDI and USER are its own and start together; no program calls it.
