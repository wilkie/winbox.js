---
kind: function
module: COMMDLG
name: WEP
ordinal: 28
summary: COMMDLG's exit procedure, which KERNEL calls as the library is let go — each dialog's segment frees what it kept, and it answers 1.
versions:
  '3.1': stub
topics: [common-dialogs, dynamic-link-libraries]
---

## Observed behaviour

KERNEL calls it as COMMDLG is freed, with one word saying why; no program calls it. Not yet measured: no probe records it.

- [[read out]] With a word not nought it answers 1 at once (`COMMDLG.DLL` seg6 `01b7`).
- [[read out]] With nought it calls, in order, the five entries that free what each part of COMMDLG kept, then answers 1: [[fn:COMMDLG.Ordinal 37]] the file dialogs' pictures and COMMDLG's memory device context; [[fn:COMMDLG.Ordinal 36]] the print dialogs'; [[fn:COMMDLG.Ordinal 35]] the Color dialog's bitmap and context; [[fn:COMMDLG.Ordinal 34]] the Font dialog's; [[fn:COMMDLG.Ordinal 33]] Find and Replace's, which is nothing (seg6 `01c2` to `01d6`).
- It pops its one word (`retf 2`).

## Nuances

- [[documented]] Windows' word for a library let go by its last user is `WEP_FREE_DLL`, nought, and for Windows ending `WEP_SYSTEM_EXIT`, 1. [[read out]] COMMDLG frees its objects only for the first.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg6 `01ad`, `retf 2`.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/commdlg/index.ts`, popping 2 bytes), with no arm in `crates/winbox-win16/src/commdlg/mod.rs`. With `COMMDLG.DLL` on the drive, the file's library is let go as KERNEL lets one go ([[topic:dynamic-link-libraries]]).
