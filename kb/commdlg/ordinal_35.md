---
kind: function
module: COMMDLG
name: Ordinal 35
ordinal: 35
summary: What the Color dialog frees as COMMDLG is let go: the spectrum's bitmap and its memory device context.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `0010`: if the object at `[0AA4h]` is there it is deleted and the word cleared; if the device context at `[02C8h]` is there it is deleted with `DeleteDC` and cleared. It takes nothing and answers nothing.
- [[read out]] [[fn:COMMDLG.WEP]] calls it third of five (seg6 `01cc`). The Color dialog makes the two in its `WM_INITDIALOG`, the device context where there is none (seg1 `17db`), and deletes both as it ends (seg1 `0920`), so they are left only by a dialog that did not end; the entry point clears `[0AA4h]` as COMMDLG loads (seg7 `005b`) ([[topic:choose-color]]).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `0010`, the Color segment's first function after its table.

## Implementation

Not WinBox's own: ordinal 35 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 0 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.
