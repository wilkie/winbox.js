---
kind: function
module: COMMDLG
name: Ordinal 34
ordinal: 34
summary: Deletes the bitmap of the Font dialog's face pictures, if it was made — called by COMMDLG's WEP as the library is freed.
versions:
  '3.1': stub
topics: [common-dialogs, choose-font]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg4 `265a` (`retf`, no arguments): where the word at `[170h]` of COMMDLG's data is not nought, `DeleteObject` of it. It answers nothing, and leaves the word as it was.
- [[read out]] `[170h]` is the bitmap the Font dialog makes once, from COMMDLG's bitmap 38, of the pictures beside a TrueType or printer face (seg4 `0475`), and makes again for `WM_SYSCOLORCHANGE` (`0839`) ([[topic:choose-font]]).
- [[read out]] The one caller is [[fn:COMMDLG.WEP]], fourth of the five clean-ups it calls when the library is freed (seg6 `01d1`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3: an entry for COMMDLG's own far call from another segment, not a function offered to programs ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg4 `265a`.

## Implementation

Not WinBox's own: ordinal 34 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping nothing, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own `WEP` calls the file's code.
