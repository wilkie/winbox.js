---
kind: function
module: COMMDLG
name: FindTextDlgProc
ordinal: 13
summary: The Find dialog's procedure, which FindText hands to USER's CreateDialogIndirectParam — the hook first, then the text, the check boxes, the direction and the buttons, each search told to the owner.
versions:
  '3.1': exact
probes: [findrepl]
topics: [common-dialogs, find-and-replace]
source: src/win16/commdlg/find-replace.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.FindText]] gives its far address to `CreateDialogIndirectParam` with the `FINDREPLACE` as the parameter; USER calls it as the dialog's procedure, with the dialog, a message, `wParam` and `lParam`, from the program's own message loop, since the dialog is modeless.

- [[read out]] It finds its data by the dialog's property A000h, four bytes holding the structure's address (`COMMDLG.DLL` seg5 `037c`). With the property, a message goes first to the program's hook, and an answer not nought is the procedure's answer.
- [[read out]] `WM_INITDIALOG` sets the dialog up from the structure's flags and text, gives the hook the message last, and shows the dialog with `SW_SHOWNORMAL` ([[topic:find-and-replace]]).
- [[read out]] `WM_COMMAND` from Find Next writes the structure and sends the owner `FINDMSGSTRING`'s message; Cancel ends the dialog; Help sends the owner `HELPMSGSTRING`'s message; the text's `EN_CHANGE` enables Find Next. `WM_CLOSE` is taken as Cancel.
- [[measured]] [[probe:findrepl]] records what the owner is told, what the hook is given, and every control's state as the dialog is used with the keys: every record is as read out, and both engines agree with all 629.

## Nuances

- [[read out]] The hook `FindText` keeps in COMMDLG's data while it makes the dialog (`[118h]`) is called by this procedure only once the property is there, and not for `WM_INITDIALOG`, which clears it. So the messages USER sends as it makes the dialog reach no hook ([[topic:find-and-replace]]).
- [[read out]] It is a procedure of its own, not [[fn:COMMDLG.ReplaceTextDlgProc]] with a flag: the two share the steps that write the structure and end the dialog (seg5 `0a89`, `0831`).

## Inside Windows

[[read out]] `COMMDLG.DLL` seg5 `036d`, `retf 0Ah`. Step by step in [[topic:find-and-replace]].

## Implementation

WinBox's own: `FindTextDlgProc` in `src/win16/commdlg/find-replace.ts` and `find_text_dlg_proc` in `crates/winbox-win16/src/commdlg/find_replace.rs`, given to USER at its stub's address. It works with no `COMMDLG.DLL` on the drive.
