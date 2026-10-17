---
kind: function
module: COMMDLG
name: PrintDlg
ordinal: 20
summary: The Print dialog, or with PD_PRINTSETUP the Print Setup dialog, or with PD_RETURNDEFAULT no dialog at all — answering whether OK was pressed and handing back the printer as a DEVNAMES, its settings as the driver's DEVMODE, and a DC or IC where asked; read out of COMMDLG.DLL and recorded.
versions:
  '3.1': exact
probes: [prdlg, prdlgx]
topics: [common-dialogs, print-dialogs]
---

## Observed behaviour

[[probe:prdlg]] calls it on the installation with a printer, an Apple LaserWriter Plus with Windows' PostScript driver, which the probe also writes into WIN.INI on `LPT1:` and `LPT2:`. It drives both dialogs with the keys and records each control, the boxes, the hooks, the owner's Help message, and what the call answers and leaves in the `PRINTDLG`, its DEVNAMES and its DEVMODE.

- [[measured]] It answers 1 for OK and nought for Cancel or a failure. OK of the Print dialog wrote `nFromPage`, `nToPage`, `nCopies` and the range, collate and file flags; a DEVNAMES and a DEVMODE are left in `hDevNames` and `hDevMode`, made by COMMDLG where the program gave none ([[topic:print-dialogs]]).
- [[measured]] `PD_RETURNDEFAULT` answers 1 at once, with the default printer's DEVNAMES, `wDefault` 4001h, and its driver's default DEVMODE, and a DC or IC with `PD_RETURNDC` or `PD_RETURNIC`.
- [[measured]] What fails answers nought and sets [[fn:COMMDLG.CommDlgExtendedError]]:

| Asked                                                              | Error                           |
| ------------------------------------------------------------------ | ------------------------------- |
| `lStructSize` not 34h                                              | 1, `CDERR_STRUCTSIZE`           |
| `PD_RETURNDEFAULT` with a DEVMODE given                            | 1003h, `PDERR_RETDEFFAILURE`    |
| `PD_ENABLEPRINTTEMPLATE` or `PD_ENABLESETUPTEMPLATE` and no name   | 3, `CDERR_NOTEMPLATE`           |
| a named template with no instance                                  | 4, `CDERR_NOHINSTANCE`          |
| a named template the instance has not                              | 7, `CDERR_LOADRESFAILURE`       |
| `PD_ENABLEPRINTTEMPLATEHANDLE` with a handle of nought             | 8, `CDERR_LOCKRESFAILURE`       |
| `PD_ENABLEPRINTHOOK` or `PD_ENABLESETUPHOOK` and no hook           | 0Bh, `CDERR_NOHOOK`             |
| a DEVNAMES of a device, driver or port WIN.INI's `[devices]` lacks | 100Bh, `PDERR_PRINTERNOTFOUND`  |
| a DEVNAMES marked `DN_DEFAULTPRN` that is not the default          | 100Ch, `PDERR_DEFAULTDIFFERENT` |
| no default printer in WIN.INI                                      | 1008h, `PDERR_NODEFAULTPRN`     |
| a default printer with no commas, or a `[devices]` value without   | 1002h, `PDERR_PARSEFAILURE`     |
| a DEVMODE, without a DEVNAMES, naming a device `[devices]` lacks   | 1007h, `PDERR_NODEVICES`        |

- [[measured]] Without a default printer and without `PD_NOWARNING`, both dialogs put up a box captioned "Print Setup", "No default printer / Use Control Panel to install and select a default printer", before failing.
- [[measured]] A call that reaches a dialog leaves the error nought, whether OK or Cancel ends it.
- [[measured]] [[probe:prdlgx]]: a dialog ended by a `WM_COMMAND` of 3 makes `PrintDlg` answer that message's `lParam`'s low word, 7 from Print Setup and 5 from the Print dialog. With `PD_RETURNDC` and Print to File checked, or `PD_RETURNDEFAULT | PD_RETURNDC | PD_PRINTTOFILE`, the DC is the driver's on `FILE:`. A program's templates, by name or by handle, are driven by their controls' ids, and a handle is left to the program.

## Nuances

- [[read out]] A named template not found is `CDERR_LOADRESFAILURE`, 7, where the other dialogs say `CDERR_FINDRESFAILURE`, 6: finding and loading are one helper that fails as one (`COMMDLG.DLL` seg3 `0a5e`, `0ec0`).
- [[read out]] A program's DEVNAMES is checked against WIN.INI before anything else but the size, and the error is cleared only after it (seg3 `0cef`, `0cfd`).
- [[read out]] The size is refused before the count COMMDLG keeps of its print calls is taken up, and the count taken down as the call ends. [[measured]] Refused as COMMDLG's first print call, the next `PD_RETURNDEFAULT` answered 1 with no DEVMODE: the driver's functions were looked for by names never loaded. COMMDLG loaded again, it had its DEVMODE ([[topic:print-dialogs]]).
- [[read out]] COMMDLG sets 8000h in the program's DEVNAMES' `wDefault` as a dialog starts and leaves it. [[measured]] The Print dialog's OK left 8001h.
- [[read out]] `PDERR_PRINTERCODES` and `PDERR_DNDMMISMATCH` are never set by `COMMDLG.DLL` 3.1.

## Inside Windows

[[read out]] `PrintDlg` is `COMMDLG.DLL` seg3 `0c94`; the default DEVNAMES is made at `00ef`, a program's checked at `0a93`, the driver loaded at `0228` and its DEVMODE asked for at `10cc`, the DC or IC made at `2fdc`. The dialogs' procedures are [[fn:COMMDLG.PrintDlgProc]] (seg3 `371f`) and [[fn:COMMDLG.PrintSetupDlgProc]] (seg3 `307a`). The whole read-out, step by step, is in [[topic:print-dialogs]].

## Implementation

WinBox's own, with `COMMDLG.DLL` on the drive or without it: `print_dlg` in `crates/winbox-win16/src/commdlg/print_dlg.rs` and `PrintDlg` in `src/win16/commdlg/print-dlg.ts`, each step of seg3 `0c94` followed, its calls into USER, GDI, KERNEL and the printer's driver made as COMMDLG makes them, its templates WinBox's own ([[topic:print-dialogs]]). [[measured]] Both engines agree with every record of [[probe:prdlg]], 376, and of [[probe:prdlgx]], 204, the printer's IC and DC made by GDI for the PostScript driver. Notepad's, Write's and Paintbrush's Print Setup and Write's Print dialog run with `COMMDLG.DLL` and without it.
