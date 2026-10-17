---
kind: function
module: COMMDLG
name: CommDlgExtendedError
ordinal: 26
summary: Why the last of COMMDLG's dialogs failed — the one doubleword COMMDLG keeps, set as a call fails and cleared as Open or Save As starts — read, not changed.
versions:
  '3.1': exact
probes: [ofnerr, ftitle]
source: src/win16/commdlg/state.ts
topics: [common-dialogs]
---

## Observed behaviour

[[probe:ofnerr]] asks [[fn:COMMDLG.GetOpenFileName]] and [[fn:COMMDLG.GetSaveFileName]] for what they refuse, and reads `CommDlgExtendedError` after each.

- [[measured]] A structure whose `lStructSize` is not 72 (0, 71, 73) is `CDERR_STRUCTSIZE`, 1, for Open and for Save As.
- [[measured]] `OFN_ENABLETEMPLATE` with no template name is `CDERR_NOTEMPLATE`, 3; with no instance, `CDERR_NOHINSTANCE`, 4; with a name the instance has no dialog of, `CDERR_FINDRESFAILURE`, 6.
- [[measured]] `OFN_ENABLEHOOK` with no hook is `CDERR_NOHOOK`, 0Bh.
- [[measured]] A file name the parser refuses, given as the dialog starts, is `FNERR_INVALIDFILENAME`, 3002h, and the dialog ends at once. A name it takes, or `OFN_NOVALIDATE`, leaves nought.
- [[measured]] The error stays until a call changes it: read after a refused call and again after one that started, it is 1 and then nought. A call that starts clears it.
- [[measured]] [[fn:COMMDLG.GetFileTitle]] sets no error ([[probe:ftitle]]).

Every code COMMDLG sets, and which function sets it, is in the table of [[topic:common-dialogs]].

## Nuances

- [[read out]] It takes no arguments and answers a `DWORD`; every code COMMDLG sets fits the low word.
- [[read out]] Not every function clears it as it starts: [[fn:COMMDLG.GetOpenFileName]] and [[fn:COMMDLG.GetSaveFileName]] do; [[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ReplaceText]] clear it only once their checks pass (seg5 `0134`); [[fn:COMMDLG.ChooseColor]] never does, so after a successful Color dialog it still reads the last failure ([[probe:choosclr]]).
- [[read out]] A wrong size is `CDERR_STRUCTSIZE` for every function but `ChooseColor`, which answers nought and leaves the error as it was.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg6 `01e7`: the entry loads COMMDLG's data segment and answers the doubleword at `[2CCh]`, `mov ax, [2CCh]; mov dx, [2CEh]` (`01f1`), and changes nothing. Each function stores its error there as it fails; [[fn:COMMDLG.GetOpenFileName]] and [[fn:COMMDLG.GetSaveFileName]] store nought as they start, once the structure's size is found right (seg2 `0a2a`).

## Implementation

There is one error, whichever code failed last ([[topic:common-dialogs]]):

- With `COMMDLG.DLL` loaded, the engines keep it where the file does. The doubleword is found from the file's own `CommDlgExtendedError`: the bytes `8E D8 A1` (`mov ds, ax; mov ax, [imm]`) in its first 24, and the offset after them, in the file's data segment. A function of the file's that fails and one of WinBox's are read alike.
- Without the file, WinBox keeps its own.

`CommDlgExtendedError`, `setError` and `error` in `src/win16/commdlg/state.ts`; `set_error` and `error` in `crates/winbox-win16/src/commdlg/mod.rs`.
