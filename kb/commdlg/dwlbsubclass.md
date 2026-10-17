---
kind: function
module: COMMDLG
name: dwLBSubclass
ordinal: 29
summary: The file dialogs' subclass of the folders' list — as the list loses the focus to anything but OK, its selection goes back to the current folder.
versions:
  '3.1': unrecorded
topics: [common-dialogs, file-dialogs]
source: src/win16/commdlg/file-init.ts
---

## Observed behaviour

No program calls it. The Open and Save As boxes' `WM_INITDIALOG` gives it to `SetWindowLong(GWL_WNDPROC)` for the folders' list, 461h (`COMMDLG.DLL` seg2 `18be`); USER then calls it as the list's window procedure. Not yet measured: no probe moves the focus off the folders' list.

- [[read out]] For `WM_KILLFOCUS` (seg2 `10b5`): COMMDLG's flag `[0054h]` is set where the window taking the focus, `wParam`, is the box's OK, and cleared otherwise.
  - Taken by OK, nothing else is done: the folder selected stays selected, so OK opens it.
  - Taken by anything else, the list's selection is put back on the current folder, row `[block + 40Bh]` less one, with `LB_SETCURSEL` sent to the list, where the box has its property A000h.
- [[read out]] Every message, `WM_KILLFOCUS` too, then goes to the list box class's own procedure through `CallWindowProc`, the one the box read with `GetClassLong(GCL_WNDPROC)` as it was set up (`[0024h]`), and its answer is answered.

## Nuances

- [[read out]] [[fn:COMMDLG.dwOKSubclass]] finishes the job: when OK then loses the focus with the flag still set, the folders' selection is put back there.
- [[read out]] The procedure called on is the class's, not the list's own before the subclass: a list a program's template had subclassed itself loses that subclass.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2 `10a5`, `retf 0Ah`.

## Implementation

WinBox's own: `dwLBSubclass` in `src/win16/commdlg/file-init.ts` and `dw_lb_subclass` in `crates/winbox-win16/src/commdlg/file_init.rs`, given to `SetWindowLong` at its stub's address.
