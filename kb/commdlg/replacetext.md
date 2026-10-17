---
kind: function
module: COMMDLG
name: ReplaceText
ordinal: 12
summary: Opens the modeless Replace dialog for a program's own window, which tells that window of each find, replacement and replacement of all with FINDMSGSTRING's message — read out of COMMDLG.DLL and recorded.
versions:
  '3.1': exact
probes: [findrepl]
topics: [common-dialogs, find-and-replace]
source: src/win16/commdlg/find-replace.ts
---

## Observed behaviour

Nothing in the installation or the corpus uses it. [[probe:findrepl]] opens it as it opens [[fn:COMMDLG.FindText]]'s dialog, with the keys.

- [[measured]] It answers the dialog's window, shown, active and open. Replace, Replace All and Find Next send the owner `FINDMSGSTRING`'s message with `FR_REPLACE`, `FR_REPLACEALL` or `FR_FINDNEXT`, and always `FR_DOWN`.
- [[measured]] When the owner answers 1 to Replace or Replace All, Cancel becomes "Close".
- [[measured]] It fails as `FindText` does, and with no `lpstrReplaceWith` or a `wReplaceWithLen` of nought: 4001h, `FRERR_BUFFERLENGTHZERO`.

## Nuances

- [[read out]] It loads COMMDLG's string 40Dh, "Close", as it starts, and fails with `CDERR_LOADSTRFAILURE` without it (`COMMDLG.DLL` seg5 `0231`).
- [[read out]] Its template is COMMDLG's dialog 1541, its procedure [[fn:COMMDLG.ReplaceTextDlgProc]], export 14. The text to find is all that enables its buttons; the replacement may be empty.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg5 `019c`, `retf 4`, its checks in `FindText`'s order with the replacement's buffer beside the find buffer and the string 40Dh loaded after the hook is checked (seg5 `01c6` to `0357`); the procedure seg5 `0582`. See [[topic:find-and-replace]].

## Implementation

WinBox's own, beside `FindText`: `src/win16/commdlg/find-replace.ts` and `crates/winbox-win16/src/commdlg/find_replace.rs`.
