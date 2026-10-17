---
kind: function
module: COMMDLG
name: dwOKSubclass
ordinal: 31
summary: The file dialogs' subclass of OK — as OK loses the focus after taking it from the folders' list, the folders' selection goes back to the current folder.
versions:
  '3.1': unrecorded
topics: [common-dialogs, file-dialogs]
source: src/win16/commdlg/file-init.ts
---

## Observed behaviour

No program calls it. The Open and Save As boxes' `WM_INITDIALOG` gives it to `SetWindowLong(GWL_WNDPROC)` for OK (`COMMDLG.DLL` seg2 `18dc`); USER then calls it as the button's window procedure. Not yet measured: no probe moves the focus from the folders' list to OK and on.

- [[read out]] For `WM_KILLFOCUS` with COMMDLG's flag `[0054h]` set -- set by [[fn:COMMDLG.dwLBSubclass]] when the folders' list gave OK the focus -- the folders' list, 461h, has its selection put back on the current folder, row `[block + 40Bh]` less one, by `SendDlgItemMessage(LB_SETCURSEL)` to the box, where the box has its property A000h; then the flag is cleared (seg2 `101f`).
- [[read out]] Every message then goes to the button class's own procedure through `CallWindowProc` (`[0028h]`, read with `GetClassLong(GCL_WNDPROC)` as the box was set up), and its answer is answered.

## Nuances

- [[read out]] OK's own command reads the flag first (seg2 `3225`): set, it clears it and opens the folder selected in the list rather than reading the name; it does the same where the folders' list has the focus and COMMDLG's own bit 40000000h of `Flags` is set (seg2 `3249`).

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2 `100f`, `retf 0Ah`.

## Implementation

WinBox's own: `dwOKSubclass` in `src/win16/commdlg/file-init.ts` and `dw_ok_subclass` in `crates/winbox-win16/src/commdlg/file_init.rs`, given to `SetWindowLong` at its stub's address.
