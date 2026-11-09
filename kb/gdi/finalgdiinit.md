---
kind: function
module: GDI
name: FinalGDIInit
ordinal: 405
summary: The end of GDI's start-up, called once by USER -- GDI binds USER's and KERNEL's entry points and loads its own tables and strings; called again, the length of its last string.
versions:
  '3.1': exact
probes: [ugaps]
records: [finalgdi]
source: crates/winbox-win16/src/gdi/system_exports.rs
topics: [gdi-internals]
---

## Observed behaviour

- [[read out]] Bit 0 of 64Ah is `[TrueType] TTEnable` (seg2 `110e`-`1126`), and with it the last call is USER's `LoadString` of GDI's string 106, F0h bytes at most, whose length AX is left: "An application used a Truetype font that caused an error in Windows." and its advice, 118 characters.
- [[measured]] [[probe:ugaps]]: called again with nought, AX 76h, two bytes popped.

## Inside Windows

[[read out]] `GDI.EXE` seg2 `012e`, given a handle, `retf 2`. It marks GDI started (`[0153h]`); in enhanced protected mode (`__WINFLAGS` 20h and 1) unlocks the pages of the given object's block; walks a table in its own code of modules and ordinals, finding each with `GetModuleHandle` and `GetProcAddress` and keeping the far pointers in its data (`0172`-`01a8`); loads its resource 1000 of type 10, 200h bytes, into its data at 67Eh (`01aa`-`01f5`); where its flags say so loads strings 69h and 6Ah with USER's `LoadString`; and with flag 2 calls `12da`.

## Callers

[[read out]] `USER.EXE` imports it, from its start-up (seg3 `2627`).

## Implementation

**Not applicable (c), with the answer of a call.** Only USER's start-up calls it. Both engines answer a later call with the length of that string, kept as a named constant, with TrueType enabled (`FinalGDIInit` in `crates/winbox-win16/src/gdi/system_exports.rs`): WinBox's GDI and USER start together, and nothing is left to do. See [[topic:gdi-internals]].
