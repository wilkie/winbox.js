---
kind: function
module: COMMDLG
name: PrintDlgProc
ordinal: 21
summary: The Print dialog's procedure, which COMMDLG hands USER for its dialog 1538 — the printer, the range, the copies, the quality and the checks of OK — exported so COMMDLG can name it, not for programs to call.
versions:
  '3.1': exact
probes: [prdlg, prdlgx]
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

It is a dialog procedure, `(HWND, UINT, WPARAM, LPARAM)`, answering a word. [[fn:COMMDLG.PrintDlg]] passes it to `DialogBoxIndirectParam` with the `PRINTDLG` as the parameter; programs do not call it.

- [[measured]] [[probe:prdlg]] records what it does to each control at each step: the printer line "Default Printer (Apple LaserWriter Plus on LPT1:)", the range, copies and quality as the structure and the DEVMODE give them, Collate enabled where the driver has `SETCOPYCOUNT`, and the parts hidden or disabled by the flags.
- [[measured]] OK refused, with a box captioned with the dialog's own caption, "Print", and the field selected again: a From below `nMinPage` or above `nMaxPage`, a To likewise, both empty with Pages checked, a From or To not a number, Copies empty, and Copies "0", "x" or 99999, each of the last three "The 'Copies' field must contain a positive value.".
- [[measured]] OK took a From of 4 and a To of 2: From above To is not checked.
- [[measured]] Help sent the owner `HELPMSGSTRING`'s message, `wParam` the dialog and `lParam` the structure. Setup... opened Print Setup on the dialog.

## Nuances

- [[read out]] Its hook is the structure's `lpfnPrintHook`, found through the property A000h, given each message first; before the property is there, the hook [[fn:COMMDLG.PrintDlg]] kept, for every message but `WM_INITDIALOG` (`COMMDLG.DLL` seg3 `3757`, `3774`).
- [[read out]] After Setup..., Print Setup's procedure leaves the setup hook kept, and this procedure then gives it the Print dialog's messages too. [[measured]] The setup hook was given messages of the Print dialog after Print Setup closed.
- [[read out]] Typing in From or To checks Pages, and checking Pages puts the focus in From (seg3 `3d13`, `3d2e`).
- [[read out]] A `WM_COMMAND` of 3 ends the dialog with its `lParam`'s low word as the answer, as OK and Cancel end it with 1 and nought.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg3 `371f`: `WM_INITDIALOG` at `1750`, the printer shown at `1503` and its qualities at `0350`, OK at `381c` with its boxes by `1004`, Cancel at `3b0e`, Setup... at `3bb4`, Help at `3cf0`. Each step is in [[topic:print-dialogs]].

## Implementation

WinBox's own: `print_dlg_proc` in `crates/winbox-win16/src/commdlg/print_proc.rs` and `PrintDlgProc` in `src/win16/commdlg/print-proc.ts`, handed to USER at its stub's address as COMMDLG hands its own export, each step of seg3 `371f` followed ([[topic:print-dialogs]]). [[measured]] Both engines agree with every record of the Print dialog in [[probe:prdlg]] and [[probe:prdlgx]]: its controls, its boxes, its hooks, Setup... and its loop, `WM_COMMAND` 3, a program's template, Print to File's DC.
