---
kind: function
module: COMMDLG
name: dwUpArrowHack
ordinal: 30
summary: The window procedure Print Setup subclasses its printers' list with on Windows 3.10, so that Up or Left in the closed list moves to and checks Default Printer rather than choosing another printer — exported so COMMDLG can pass it to SetWindowLong.
versions:
  '3.1': partial
probes: [prdlg]
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

It is a window procedure, `(HWND, UINT, WPARAM, LPARAM)`, answering a doubleword. Print Setup's `WM_INITDIALOG` puts it in place of the printers' combo box's own with `SetWindowLong(GWL_WNDPROC)`, after giving the three lists the extended UI; programs do not call it.

- [[read out]] `WM_KEYDOWN` of `VK_UP` or `VK_LEFT` while the list is not dropped (`CB_GETDROPPEDSTATE` answers nought) sends the dialog `WM_NEXTDLGCTL` to the Default Printer button (422h) and checks it with `CheckRadioButton(422h, 423h, 422h)`, answering nought; the combo box never sees the key. Everything else goes to the combo box's own procedure by `CallWindowProc` (`COMMDLG.DLL` seg3 `0056`).
- [[measured]] [[probe:prdlg]] chose Specific Printer by its mnemonic, which put the focus in the list, then pressed Up: Default Printer was checked and had the focus, Specific Printer unchecked, and the list still showed the printer it had.

## Nuances

- [[read out]] `CheckRadioButton` sends no `WM_COMMAND`, so the dialog's procedure does not take the default printer again for the key: the orientation and paper stay those of the printer the list shows until another choice is made. OK takes the default printer, as Default Printer is checked ([[fn:COMMDLG.PrintSetupDlgProc]]).
- [[read out]] It is put in place only where the Windows version is 3.10 or later (`[0CAEh]`, seg3 `29b9`), as is the extended UI the three lists are given in the same step. [[inferred]] With the extended UI, a closed list would otherwise take Up as a new choice of printer.
- [[read out]] The old procedure is kept in one doubleword of COMMDLG's data (`[0A78h]`, seg3 `2a19`).

## Inside Windows

[[read out]] seg3 `0056` to `00ec`: `cmp [bp+0Ch], 100h`, the two keys, `SendMessage(hwnd, 417h)`, `GetParent`, `SendMessage(WM_NEXTDLGCTL)`, `CheckRadioButton`, else `CallWindowProc([0A78h], …)`.

## Implementation

Not WinBox's own yet: a stub in `src/win16/commdlg/index.ts`, popping 10 bytes, and no arm in `crates/winbox-win16/src/commdlg/mod.rs`. With `COMMDLG.DLL` on the drive, the file's own procedure subclasses the list. [[measured]] Both engines agree with the probe's record of the key, running the file's code.
