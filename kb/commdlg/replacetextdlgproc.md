---
kind: function
module: COMMDLG
name: ReplaceTextDlgProc
ordinal: 14
summary: The Replace dialog's procedure, which ReplaceText hands to USER's CreateDialogIndirectParam — Find Next, Replace and Replace All told to the owner, Cancel turned to Close once something is replaced.
versions:
  '3.1': exact
probes: [findrepl]
topics: [common-dialogs, find-and-replace]
source: src/win16/commdlg/find-replace.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.ReplaceText]] gives its far address to `CreateDialogIndirectParam` with the `FINDREPLACE` as the parameter; USER calls it as the modeless dialog's procedure, with the dialog, a message, `wParam` and `lParam`.

- [[read out]] As [[fn:COMMDLG.FindTextDlgProc]], it finds the structure by the property A000h (`COMMDLG.DLL` seg5 `0591`) and gives the hook each message first.
- [[read out]] `WM_INITDIALOG` sets both texts, sending each its `EN_CHANGE`, and shows the dialog with `SW_SHOW`.
- [[read out]] Find Next, Replace and Replace All write the structure with `FR_FINDNEXT`, `FR_REPLACE` or `FR_REPLACEALL`, always with `FR_DOWN`, and send the owner `FINDMSGSTRING`'s message. Where the owner answers exactly 1 to Replace or Replace All, Cancel's text becomes COMMDLG's string 40Dh, "Close".
- [[measured]] [[probe:findrepl]] records the owner told 191h, 1A1h and 189h, and Cancel saying "Close" after the owner answered 1: as read out, and both engines agree.

## Nuances

- [[read out]] Only the text to find enables Find Next, Replace and Replace All; the replacement may be empty.
- The rest is [[topic:find-and-replace]].

## Inside Windows

[[read out]] `COMMDLG.DLL` seg5 `0582`, `retf 0Ah`.

## Implementation

WinBox's own: `ReplaceTextDlgProc` in `src/win16/commdlg/find-replace.ts` and `replace_text_dlg_proc` in `crates/winbox-win16/src/commdlg/find_replace.rs`. It works with no `COMMDLG.DLL` on the drive.
