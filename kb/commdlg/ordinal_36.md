---
kind: function
module: COMMDLG
name: Ordinal 36
ordinal: 36
summary: Frees the portrait and landscape icons the print dialogs load, as COMMDLG is unloaded — called by its WEP.
versions:
  '3.1': stub
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg3 `3da8` (`retf`, no arguments): `FreeResource` of each of the two icons the print dialogs keep, `[1D4h]` and `[1D6h]` in COMMDLG's data, where it is not nought, then both written nought. It answers nothing.
- [[read out]] Its one caller is [[fn:COMMDLG.WEP]], unloading for a reason other than Windows ending (seg6 `01c7`), between [[fn:COMMDLG.Ordinal 37]] and [[fn:COMMDLG.Ordinal 35]].

## Nuances

- [[read out]] The icons are 528, portrait, and 529, landscape, loaded with `LoadIcon` and locked on the first of COMMDLG's print calls (seg3 `3de2`), and unlocked when the last one in progress ends (seg3 `3ed8`), but freed only here: they stay loaded between calls ([[topic:print-dialogs]]).
- [[read out]] Like every unnamed entry, its flags are 0, not the 3 of a named export: it is an entry point for COMMDLG's own far call into a moveable segment, not a function offered to programs ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg3 `3da8` to `3de1`: two tests of a word and `FreeResource`, then `mov [1D6h], ax; mov [1D4h], ax` with AX nought.

## Implementation

Not WinBox's own: ordinal 36 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping nothing, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive, the file's `WEP` calls the file's own entry.
