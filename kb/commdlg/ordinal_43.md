---
kind: function
module: COMMDLG
name: Ordinal 43
ordinal: 43
summary: Gives a GDI object COMMDLG keeps to COMMDLG's own instance, through GDI's SetObjectOwner found by ordinal, on Windows 3.10 or later.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg6 `0160` (`retf 2`): one word, the object. Only where the version COMMDLG read as it loaded is 3.10 or later (`[0CAEh]` at least 30Ah): `GetModuleHandle("GDI")`, then `GetProcAddress` of its ordinal 461, [[fn:GDI.SetObjectOwner]], which is called with the object and COMMDLG's instance (`[02CAh]`). It answers nothing.
- [[read out]] Callers: the entry point, for its memory device context (seg7 `0203`); the file dialogs' pictures (seg2 `0f29`); and the Font dialog (seg4 `27ff`, [[topic:choose-font]]).

## Nuances

- [[read out]] In Windows 3.1, `SetObjectOwner` itself does nothing ([[fn:GDI.SetObjectOwner]]).
- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg6 `0160`; the module's name is the string at `[0172h]` of COMMDLG's data, `GDI`.

## Implementation

Not WinBox's own: ordinal 43 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 2 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.
