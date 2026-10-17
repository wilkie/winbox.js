---
kind: function
module: COMMDLG
name: EditIntegerOnly
ordinal: 23
summary: The window procedure the Print dialog subclasses its From, To and Copies edits with, refusing any character but a digit or Backspace with a beep — exported so COMMDLG can pass it to SetWindowLong.
versions:
  '3.1': exact
probes: [prdlg]
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

It is a window procedure, `(HWND, UINT, WPARAM, LPARAM)`, answering a doubleword. The Print dialog's `WM_INITDIALOG` puts it in place of the edits' own with `SetWindowLong(GWL_WNDPROC)`; programs do not call it.

- [[read out]] `WM_CHAR` of anything but Backspace (8) or a digit, `0` to `9`, is answered nought after `MessageBeep(0)`, and the edit never sees it. Everything else goes to the edit's own procedure by `CallWindowProc` (`COMMDLG.DLL` seg3 `0000`).
- [[measured]] [[probe:prdlg]] put the focus in Copies by its mnemonic and typed `A` then `7`: Copies held "7".

## Nuances

- [[read out]] Only the first edit's old procedure is kept, in one doubleword of COMMDLG's data (`[0A7Ch]`, seg3 `1b77`); the To and Copies edits are subclassed without theirs being kept, and all three are passed on to that one. All three are COMMDLG's template's edits, of the one class.
- [[read out]] A pasted or set text is not checked: `SetDlgItemText` and `WM_PASTE` reach the edit. OK checks the numbers itself ([[fn:COMMDLG.PrintDlgProc]]). [[measured]] "x" set in From was refused by OK with its box.
- [[read out]] A minus sign is refused too; the edits hold only unsigned numbers.

## Inside Windows

[[read out]] seg3 `0000` to `0053`: `cmp [bp+0Ch], 102h`, the two tests of the character, `MessageBeep`, else `CallWindowProc([0A7Ch], …)`.

## Implementation

WinBox's own: `edit_integer_only` in `crates/winbox-win16/src/commdlg/print_dlg.rs` and `EditIntegerOnly` in `src/win16/commdlg/print-dlg.ts`, put in place of the three edits' procedure at its stub's address, the From edit's own kept as COMMDLG keeps it. [[measured]] Both engines agree with [[probe:prdlg]]'s typed record.
