---
kind: function
module: COMMDLG
name: PrintSetupDlgProc
ordinal: 22
summary: The Print Setup dialog's procedure, which COMMDLG hands USER for its dialog 1539, from PrintDlg or from the Print dialog's Setup button — the printers from WIN.INI, the orientation, the paper sizes and sources the driver names — exported so COMMDLG can name it, not for programs to call.
versions:
  '3.1': exact
probes: [prdlg, prdlgx]
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

It is a dialog procedure, `(HWND, UINT, WPARAM, LPARAM)`, answering a word. [[fn:COMMDLG.PrintDlg]] passes it to `DialogBoxIndirectParam` for `PD_PRINTSETUP`, and the Print dialog's procedure, [[fn:COMMDLG.PrintDlgProc]], for its Setup button, each with the `PRINTDLG`.

- [[measured]] [[probe:prdlg]] records each control at each step. As it starts: Default Printer checked; the printers "Apple LaserWriter Plus on LPT1:" and "… on LPT2:", the first chosen and the list without a tab stop; "(currently Apple LaserWriter Plus on LPT1:)"; Portrait; seven paper sizes from COMMDLG's strings, Letter chosen; the driver's two sources, "Upper Tray" and "Manual Feed".
- [[measured]] Specific Printer, by its mnemonic, put the focus in the printers' list and gave it a tab stop. Up in the closed list checked Default Printer and moved the focus there ([[fn:COMMDLG.dwUpArrowHack]]).
- [[measured]] The second printer chosen and Landscape, OK answered 1 with a DEVNAMES of `LPT2:`, `wDefault` nought, and the DEVMODE's `dmOrientation` 2. Opened from Print, its Landscape reached the Print dialog's DEVMODE.
- [[measured]] Cancel answered nought and freed the DEVNAMES COMMDLG had made.
- [[measured]] Help sent the owner `HELPMSGSTRING`'s message with the dialog and the structure.
- [[measured]] [[probe:prdlgx]]: Options... ran the PostScript driver's own dialog, "Options", through its `ExtDeviceMode`; its OK left the lists as they were. A `WM_COMMAND` of 4 answered nought and took the structure's printer again, the orientation disabled and the paper's lists emptied where the structure had no DEVMODE; one of 3 ended the dialog with its `lParam`'s low word.

## Nuances

- [[read out]] Its hook is the structure's `lpfnSetupHook`, given each message first through the property A000h; before the property is there, the one [[fn:COMMDLG.PrintDlg]] kept. Opened from the Print dialog nothing was kept, and as it ends it keeps the setup hook, which the Print dialog then gives its messages too (`COMMDLG.DLL` seg3 `30b1`, `30ce`, `3397`). [[measured]] The setup hook, from Print, was given nothing before its `WM_INITDIALOG`.
- [[read out]] It works on a DEVMODE of its own, the driver's default or a copy of the program's, and hands it over only at OK, with the orientation, paper size and source written into it (seg3 `2b43`, `32fc`).
- [[read out]] A `WM_COMMAND` of 3 ends the dialog with its `lParam`'s low word; one of 4 takes the structure's printer and DEVMODE again (seg3 `33c8`).
- [[read out]] It answers `WM_MEASUREITEM` with the height of the dialog's font, or the System font's, measured once and kept (seg3 `2f59`): for an owner-drawn control of a program's template, since COMMDLG's has none.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg3 `307a`: `WM_INITDIALOG` at `2559`, the printers listed at `07ad`, a printer taken at `2c62`, the sizes at `1d7c`, the sources at `2026`, the orientation at `236a` and `1bea`, OK and Cancel at `31fd`. Each step is in [[topic:print-dialogs]].

## Implementation

WinBox's own: `print_setup_dlg_proc` in `crates/winbox-win16/src/commdlg/print_setup.rs` and `PrintSetupDlgProc` in `src/win16/commdlg/print-setup.ts`, handed to USER at its stub's address, each step of seg3 `307a` followed; the driver's `ExtDeviceMode`, `DeviceCapabilities` and `AdvancedSetupDialog` called at the addresses `GetProcAddress` gives ([[topic:print-dialogs]]). [[measured]] Both engines agree with every record of Print Setup in [[probe:prdlg]] and [[probe:prdlgx]], opened by `PrintDlg` and from the Print dialog, the driver's own Options dialog among them. Notepad's, Write's and Paintbrush's Print Setup run with `COMMDLG.DLL` and without it.
