---
kind: topic
name: Print dialogs
summary: COMMDLG's Print and Print Setup dialogs — PRINTDLG and its flags, the DEVNAMES and DEVMODE it hands back, the printers it finds in WIN.INI, what it asks the printer's driver, each control, the checks of OK, the hooks and templates, and every error — read out of COMMDLG.DLL and recorded on the installation with a printer.
probes: [prdlg, prdlgx]
---

[[fn:COMMDLG.PrintDlg]] runs one of two modal dialogs: **Print**, which asks what to print, how many copies and at what quality, or, with `PD_PRINTSETUP`, **Print Setup**, which chooses the printer, the orientation, the paper size and its source. Print has a Setup button that opens Print Setup on top of it. Each is a dialog of `COMMDLG`'s instance with its own procedure, [[fn:COMMDLG.PrintDlgProc]] and [[fn:COMMDLG.PrintSetupDlgProc]]. Notepad, Cardfile, Write, Paintbrush, Calendar, Terminal and WinHelp use it, as do wordsrch and SimTower's EREGLIB in the corpus. Every address on this page is in `COMMDLG.DLL` seg3 unless it says otherwise. The general mechanisms — the registered messages, the extended error, hooks and templates — are in [[topic:common-dialogs]]; what GDI does with the printer once a program prints is in [[topic:printing]].

[[measured]] [[probe:prdlg]] runs on the installation with a printer, `vgaprint`: an Apple LaserWriter Plus with Windows' PostScript driver, `pscript`. The probe writes into WIN.INI the default printer, that printer on `LPT1:`, and the same printer on `LPT2:` too, so the run finds the same entries wherever it runs. It drives both dialogs with the keys, reads every control at each step, answers each box COMMDLG puts up, and records what the call answers and leaves. [[probe:prdlgx]] does the same for the cases it leaves out: Options... and the driver's own dialog, `WM_COMMAND` 3 and 4, a program's templates, a DC on `FILE:`, and Setup... opening Print Setup again.

## The structures

`PRINTDLG`, 52 bytes (34h):

| Offset | Field                 | What COMMDLG does with it                                                                    |
| ------ | --------------------- | -------------------------------------------------------------------------------------------- |
| 0      | `lStructSize`         | must be 34h, the whole doubleword (`0cba`)                                                   |
| 4      | `hwndOwner`           | the dialog's owner; sent `HELPMSGSTRING`'s message; the window given to the driver           |
| 6      | `hDevMode`            | the program's DEVMODE, copied in; replaced by the one the dialog leaves                      |
| 8      | `hDevNames`           | the program's DEVNAMES, checked against WIN.INI; made by COMMDLG where nought                |
| 0Ah    | `hDC`                 | the DC or IC made for `PD_RETURNDC` or `PD_RETURNIC`; nought written otherwise by Setup's OK |
| 0Ch    | `Flags`               | read throughout; Print's OK writes the range, collate and file bits                          |
| 10h    | `nFromPage`           | shown unless FFFFh; written by Print's OK                                                    |
| 12h    | `nToPage`             | the same                                                                                     |
| 14h    | `nMinPage`            | the lowest page OK takes                                                                     |
| 16h    | `nMaxPage`            | the highest                                                                                  |
| 18h    | `nCopies`             | shown, nought shown as 1; written by Print's OK                                              |
| 1Ah    | `hInstance`           | the module of a named template                                                               |
| 1Ch    | `lCustData`           | not read                                                                                     |
| 20h    | `lpfnPrintHook`       | written nought without `PD_ENABLEPRINTHOOK`                                                  |
| 24h    | `lpfnSetupHook`       | written nought without `PD_ENABLESETUPHOOK`                                                  |
| 28h    | `lpPrintTemplateName` | with `PD_ENABLEPRINTTEMPLATE`                                                                |
| 2Ch    | `lpSetupTemplateName` | with `PD_ENABLESETUPTEMPLATE`                                                                |
| 30h    | `hPrintTemplate`      | with `PD_ENABLEPRINTTEMPLATEHANDLE`                                                          |
| 32h    | `hSetupTemplate`      | with `PD_ENABLESETUPTEMPLATEHANDLE`                                                          |

The flags: `PD_ALLPAGES` 0, `PD_SELECTION` 1, `PD_PAGENUMS` 2, `PD_NOSELECTION` 4, `PD_NOPAGENUMS` 8, `PD_COLLATE` 10h, `PD_PRINTTOFILE` 20h, `PD_PRINTSETUP` 40h, `PD_NOWARNING` 80h, `PD_RETURNDC` 100h, `PD_RETURNIC` 200h, `PD_RETURNDEFAULT` 400h, `PD_SHOWHELP` 800h, `PD_ENABLEPRINTHOOK` 1000h, `PD_ENABLESETUPHOOK` 2000h, `PD_ENABLEPRINTTEMPLATE` 4000h, `PD_ENABLESETUPTEMPLATE` 8000h, `PD_ENABLEPRINTTEMPLATEHANDLE` 10000h, `PD_ENABLESETUPTEMPLATEHANDLE` 20000h, `PD_USEDEVMODECOPIES` 40000h, `PD_DISABLEPRINTTOFILE` 80000h, `PD_HIDEPRINTTOFILE` 100000h. [[read out]] Nothing in seg3 tests 200000h, `PD_NONETWORKBUTTON` of later headers.

**`DEVNAMES`** is four words and the strings they point to: `wDriverOffset`, `wDeviceOffset`, `wOutputOffset`, each from the block's start, and `wDefault`, whose bit 1, `DN_DEFAULTPRN`, says it is the default printer.

- [[read out]] COMMDLG writes the device first, at 8, then the driver, then the port (`00ef`, `06be`, `1245`). [[measured]] The default printer came back as offsets 1Fh, 8, 27h: `pscript`, `Apple LaserWriter Plus`, `LPT1:`.
- [[read out]] COMMDLG uses two more bits of `wDefault` as its own. 4000h marks a DEVNAMES COMMDLG made during the call: Cancel frees it and writes `hDevNames` nought (`3b0e`, `32e1`), OK clears the bit (`3afb`, `3305`). 8000h is set in the program's DEVNAMES as either dialog starts (`1899`, `26e5`) and never cleared. [[measured]] The default printer from `PD_RETURNDEFAULT` came back with `wDefault` 4001h; from the Print dialog's OK, 8001h; from a Print dialog cancelled over the program's own DEVNAMES, 8000h; from Print Setup's OK for the second printer, nought.

**`DEVMODE`** is the driver's: COMMDLG reads `dmDeviceName` (0), `dmSpecVersion` (20h) and `dmDriverVersion` (22h), and writes `dmOrientation` (2Ch), `dmPaperSize` (2Eh), `dmCopies` (36h), `dmDefaultSource` (38h), `dmPrintQuality` (3Ah) and, where the Windows version is 3.10 or later, `dmYResolution` (40h). [[measured]] The PostScript driver's DEVMODE has `dmSpecVersion` 30Ah and `dmSize` 44h, 198 bytes with its own after them.

## Printers and their drivers

- [[read out]] **The default printer** is WIN.INI's `[windows]` `device=`, three parts split at commas: device, driver, port (`00ef`). The DEVNAMES made of it has `wDefault` 4001h. No `device=`, or an empty one, is `PDERR_NODEFAULTPRN`; no comma is `PDERR_PARSEFAILURE`.
- [[read out]] **Every printer** is a key of `[devices]`, its value the driver and one port or more (`07ad`). Print Setup's list has an item for each printer on each port, written by string 447h, "`%s on %s%s`", the device, the port and nothing; a port `WNetGetConnection` knows is written by string 442h, "`%s on %s (%s)`", with the network name lowered (`062e`). Each item's data is a DEVNAMES of its own (`06be`). [[measured]] `Apple LaserWriter Plus on LPT1:` and `Apple LaserWriter Plus on LPT2:`.
- [[read out]] **A program's DEVNAMES** is checked as the call starts (`0a93`): its device must be a key of `[devices]` whose driver is its driver, compared without case, and whose ports include its port; else `PDERR_PRINTERNOTFOUND`. With `DN_DEFAULTPRN`, it must also be the default printer, driver, device and port, else `PDERR_DEFAULTDIFFERENT`. [[measured]] A device WIN.INI lacks, another driver, another port: 100Bh each; the second port marked default: 100Ch.
- [[read out]] **A program's DEVMODE without a DEVNAMES** names its printer by `dmDeviceName`, looked up in `[devices]`; the DEVNAMES is made of it and the first port (`1245`). [[measured]] A name `[devices]` lacks: `PDERR_NODEVICES`, 1007h; a value without a comma: 1002h.
- [[read out]] **The driver** is loaded by its name with `.DRV` added, `LoadLibrary` under `SetErrorMode(8003h)` (`0228`). Its functions are found by name, the names being COMMDLG's strings 443h "ExtDeviceMode", 444h "DeviceMode" and 445h "DeviceCapabilities", and "AdvancedSetupDialog" in its data.
- [[read out]] **The DEVMODE** is the driver's `ExtDeviceMode` (`10cc`): asked its size with a mode of nought, then the default with `DM_COPY` into a block of that size, or, given the program's, `DM_COPY | DM_MODIFY` from it into a new block. A driver with `DeviceMode` but no `ExtDeviceMode` has no DEVMODE, and a dialog runs without one; with neither, the dialog fails with `PDERR_GETDEVMODEFAIL`.
- [[read out]] **What the driver can do** is asked of `DeviceCapabilities` where the DEVMODE's `dmSpecVersion` is 30Ah or more: `DC_PAPERS` and `DC_PAPERNAMES` for the paper sizes, `DC_BINS` and `DC_BINNAMES` for the sources, `DC_ENUMRESOLUTIONS` for the qualities, `DC_ORIENTATION` for landscape. Older drivers are asked with `GETSETPAPERBINS` and `ENUMPAPERBINS` escapes for their sources, and have the four qualities of COMMDLG's own. Some drivers are named in COMMDLG's data: with `CITOH`, `IBMGRX`, `TI850`, `TOSHIBA`, `THINKJET`, `IBMCOLOR` or `CANON10E` the paper sizes are not asked for (`02c1`), and with `HPPCL`, `HPPCL5A` before driver version 3850h or `SD_LJET` of a DEVMODE older than 30Ah, the sizes or the sources are not (`0307`).
- [[measured]] The PostScript driver, asked directly as COMMDLG asks it: `ExtDeviceMode`, `DeviceMode` and `DeviceCapabilities` all there, 7 papers, 2 bins, 1 resolution.

## The call

[[read out]] `PrintDlg` (`0c94`):

1. The hourglass ([[fn:COMMDLG.Ordinal 32]]). `lStructSize` not 34h is `CDERR_STRUCTSIZE`.
2. On the first of COMMDLG's print calls, the portrait and landscape icons, 528 and 529, are loaded and locked, and strings 443h–445h read into its data; failing, `PDERR_SETUPFAILURE` (`3de2`). A count keeps how many calls are in progress.
3. A program's DEVNAMES is checked, as above. Then the error is cleared.
4. **`PD_RETURNDEFAULT`**: with a DEVNAMES or a DEVMODE given, `PDERR_RETDEFFAILURE`. Else the default printer's DEVNAMES is made, its driver loaded (`PDERR_LOADDRVFAILURE` if not), its default DEVMODE asked for, and, with `PD_RETURNDC` or `PD_RETURNIC`, the DC or IC made (`2fdc`). The answer is 1, or nought with the DEVNAMES freed. No dialog. [[measured]] It answered 1 with the default printer's DEVNAMES and DEVMODE, and a DC for either flag.
5. Otherwise the template: with `PD_PRINTSETUP`, the program's handle (`PD_ENABLESETUPTEMPLATEHANDLE`), its named dialog (`PD_ENABLESETUPTEMPLATE`, no name `CDERR_NOTEMPLATE`, no instance `CDERR_NOHINSTANCE`), else COMMDLG's 1539, "Print Setup"; and the setup hook kept for the messages before `WM_INITDIALOG`. Without it, the same with the print flags and fields and COMMDLG's 1538, "Print". A named template not found, or not loaded, is `CDERR_LOADRESFAILURE`, 7, not `CDERR_FINDRESFAILURE` (`0a5e`); a template not locked is `CDERR_LOCKRESFAILURE`.
6. `DialogBoxIndirectParam` on COMMDLG's instance, the owner, the procedure and the structure. -1 is `CDERR_DIALOGFAILURE`, answering nought. The kept hook is cleared, the template unlocked and freed unless the program's handle, the count taken down, the arrow set.
7. The answer is what the dialog ended with.

[[measured]] A size of 33h was refused with 1, and every other refusal was as read out, among them a template name not found, 7, and a template handle of nought, 8.

[[measured]] [[probe:prdlgx]] gave both dialogs templates of its own by name, and Print Setup one by handle: each laid out its own way, with its own caption and labels, without Options..., Setup... and Help, and with a static of its own. COMMDLG drove the controls it found by their ids and filled the printer's line, lists and checks as in its own; the controls it did not find it let be, and the program's own static was left as the template made it. The handle was the program's still once `PrintDlg` returned.

### A refused size before the first call

[[read out]] The size is refused before step 2 takes the count up, but the call ends through step 6, which takes it down (`0cc7`, `0fec`, `3ed8`). Where no print call has yet loaded the strings of step 2, the count is then below nought, the next call takes it to nought and is let through without loading them, and the driver's functions are looked for by empty names: no DEVMODE. [[measured]] Refused for its size as COMMDLG's first print call, the next `PD_RETURNDEFAULT` answered 1 with no DEVMODE and no error; with COMMDLG let go and loaded again, the same call had its DEVMODE. Once the strings are loaded they stay: a size refused later did no harm.

## The Print dialog

[[read out]] Dialog 1538, "Print", 225 × 130 in 8-point "Helv": "Printer:" (445h) and the printer (440h, "System Default" in the template); the "Print Range" group (430h) with "&All" (420h), "S&election" (421h) and "&Pages" (422h), "&From:" (441h) and its edit (480h), "&To:" (442h) and its edit (481h); "Print &Quality:" (443h) and its drop-down list (470h); "&Copies:" (444h) and its edit (482h); "Print to Fi&le" (410h) and "Collate Cop&ies" (411h), both check boxes; OK (1, the default), Cancel (2), "&Setup..." (400h) and "&Help" (40Eh).

### As it starts

[[read out]] `WM_INITDIALOG` (`1750`):

1. Six bytes of COMMDLG's local memory, the structure's address and a word, put under the property A000h; failing, `CDERR_MEMALLOCFAILURE` and the dialog ended.
2. A hook asked for and not given, print or setup, is `CDERR_NOHOOK`; a hook not asked for is written nought.
3. On Windows 3.10, the quality list gets the extended UI.
4. The printer: the program's DEVNAMES, or one made of its DEVMODE's device, or the default's (`1245`). Without a default and without `PD_NOWARNING`, a box with COMMDLG's string 45Ah, "No default printer / Use Control Panel to install and select a default printer", captioned "Print Setup", before the dialog ends.
5. The driver loaded, and the DEVMODE asked of it where the program gave none.
6. The copies' edit limited to five characters; `nCopies` of nought made 1, and shown.
7. The printer shown (`1503`): with a DEVMODE, the quality label and list enabled and the list filled, and `dmCopies` above 1 shown as the copies; without, both disabled. An IC of the printer is made; failing, `PDERR_CREATEICFAILURE`. If the driver has the `SETCOPYCOUNT` escape, Collate is enabled and checked for `PD_COLLATE`; if not, it is disabled and checked, and with `PD_USEDEVMODECOPIES` the copies are 1 and their edit disabled. The IC is deleted. The printer line is "`<device> on <port>`", or for the default string 441h, "Default Printer (", then that and ")".
8. Help hidden and disabled without `PD_SHOWHELP`. Print to File hidden and disabled with `PD_HIDEPRINTTOFILE`, disabled with `PD_DISABLEPRINTTOFILE`, checked by `PD_PRINTTOFILE`.
9. With `PD_NOPAGENUMS`, Pages, its labels and edits disabled and `PD_PAGENUMS` cleared; else From and To shown unless FFFFh. With `PD_NOSELECTION`, Selection disabled and `PD_SELECTION` cleared. Pages, Selection or All checked, in that order of the flags.
10. The three edits subclassed with [[fn:COMMDLG.EditIntegerOnly]].
11. The print hook given `WM_INITDIALOG` and its answer answered; without one, 1.

A step that fails ends the dialog with nought, the error left as it was, or `PDERR_INITFAILURE` where none was set.

[[measured]] With the flags a program gives, the printer read "Default Printer (Apple LaserWriter Plus on LPT1:)", Pages checked and the only radio button with a tab stop, From 2, To 5, copies 3, Collate enabled and checked: the PostScript driver has `SETCOPYCOUNT`. The quality list held one item, "300 dpi". With `PD_HIDEPRINTTOFILE`, `PD_NOSELECTION` and `PD_NOPAGENUMS`, Print to File and Help were neither enabled nor shown and Selection, Pages and the range's edits and labels were disabled. With `PD_DISABLEPRINTTOFILE` and `PD_PRINTTOFILE`, Print to File was disabled and checked.

### The qualities

[[read out]] The list is filled again for each printer (`0350`). With a DEVMODE of version 30Ah or more and `DeviceCapabilities`, each resolution of `DC_ENUMRESOLUTIONS` is an item, "`%ld dpi`" where the two are equal and "`%ld dpi x %ld dpi`" where not, its data the two as a doubleword; the item whose x is `dmPrintQuality`, and whose y is `dmYResolution` where that is not nought, is chosen. Otherwise the items are COMMDLG's strings 430h–433h, "High", "Medium", "Low" and "Draft", their data -4 to -1, the `DMRES_` values, and a quality outside them is taken as High. Each item is inserted at the top, so the list ends in the driver's order.

### What the controls do

- [[read out]] Typing in From or To (`EN_CHANGE`) checks Pages; checking Pages moves the focus to From (`3d13`, `3d2e`).
- [[read out]] **Help** sends the owner `HELPMSGSTRING`'s message, `wParam` the dialog and `lParam` the structure. [[measured]] As read out.
- [[read out]] **Setup...** opens Print Setup on the dialog, with the setup template chosen as `PrintDlg` chooses it and [[fn:COMMDLG.PrintSetupDlgProc]] (`3bb4`). Where it ends with `PDERR_DEFAULTDIFFERENT` or `PDERR_DNDMMISMATCH`, the DEVNAMES is freed and Print Setup opened again. Once it ends with OK, the printer is shown again; either way the focus goes to OK. [[measured]] [[probe:prdlgx]] made `LPT2:` the default printer under the Print dialog and pressed Setup...: the first Print Setup failed in its `WM_INITDIALOG` over the Print dialog's DEVNAMES, marked the default and on `LPT1:`, and the second came up on a DEVNAMES made of the DEVMODE's device and its first port, Specific Printer checked on `LPT1:` with the focus, "(currently Apple LaserWriter Plus on LPT2:)". Cancelled, the Print dialog still showed "Default Printer (Apple LaserWriter Plus on LPT1:)", and its own Cancel freed the DEVNAMES made in the loop: `hDevNames` nought.
- [[read out]] **Print to File** with `PD_RETURNDC` or `PD_RETURNIC` makes the context on the port `FILE:` (`2ff5`), as `PD_PRINTTOFILE` does for `PD_RETURNDEFAULT`. [[measured]] Either way the DC was the PostScript driver's, `TECHNOLOGY` 2, `DT_RASPRINTER`, and 2394 pixels across; the flags 120h and 520h.
- [[read out]] **OK** (`381c`) clears `PD_SELECTION`, `PD_PAGENUMS`, `PD_COLLATE` and `PD_PRINTTOFILE` and checks, in this order, each failure a box with the dialog's caption and the field selected again:

| What                                           | Box, COMMDLG's string                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Copies empty                                   | 457h, "The 'Copies' field is empty."                                                     |
| Copies not a number, or nought                 | 459h, "The 'Copies' field must contain a positive value."                                |
| Pages: From not a number but not empty         | 454h, "The 'From' field contains non-numeric characters or a number greater than 65535." |
| Pages: To likewise                             | 455h, the same of 'To'                                                                   |
| Pages: both empty                              | 456h, "The 'From' and 'To' fields are empty and the Pages button is pressed."            |
| Pages: From below `nMinPage`, or above the max | 450h, 451h                                                                               |
| Pages: To below `nMinPage`, or above the max   | 452h, 453h                                                                               |

- [[read out]] Copies is read by [[fn:USER.GetDlgItemInt]], which answers nought for what it cannot read, and nought is tested before the text: string 458h, "The 'Copies' field contains non-numeric characters.", is never chosen. [[measured]] "x" and 99999 in Copies were each answered with 459h.
- [[read out]] An empty From is taken as `nMinPage`, an empty To as `nMaxPage`. From above To is not checked. [[measured]] From 4, To 2 was taken and written.
- [[read out]] Then `PD_SELECTION` or `PD_PAGENUMS` for the radio button checked, `PD_PRINTTOFILE` and `PD_COLLATE` for the boxes. With a DEVMODE: `PD_USEDEVMODECOPIES` puts the copies in `dmCopies` and 1 in `nCopies`; else `dmCopies` is 1. The quality chosen is written to `dmPrintQuality`, and on 3.10 its y to `dmYResolution`. Then the DC or IC for `PD_RETURNDC` or `PD_RETURNIC` — on the port `FILE:` with `PD_PRINTTOFILE` — and the DEVNAMES' 4000h cleared. [[measured]] Copies 2: `nCopies` 2, `dmCopies` 1; with `PD_USEDEVMODECOPIES` and 4: `nCopies` 1, `dmCopies` 4. The quality 300 dpi was written as 300 and 300.
- [[read out]] **Cancel** frees a DEVNAMES COMMDLG made. OK, Cancel and a `WM_COMMAND` of 3 end the dialog — the last with its `lParam`'s low word as the answer — removing the property and freeing its memory. [[measured]] Cancel answered nought with the error nought.

## The Print Setup dialog

[[read out]] Dialog 1539, "Print Setup", 287 × 122: the "Printer" group (432h) with "(No Default Printer)" (440h), "&Default Printer" (422h) and "Specific &Printer:" (423h), both radio buttons, and the printers' drop-down list (470h); the "Orientation" group (430h) with the icon (43Ch), "Po&rtrait" (420h) and "&Landscape" (421h); the "Paper" group (431h) with "Si&ze:" (441h) and its list (471h), "&Source:" (442h) and its list (472h); OK, Cancel, "&Options..." (400h) and "&Help".

### As it starts

[[read out]] `WM_INITDIALOG` (`2559`):

1. Six bytes under the property A000h, as Print's; a setup hook asked for and not given is `CDERR_NOHOOK`, one not asked for written nought. COMMDLG's string 448h, "Print Setup", read as the caption of its boxes.
2. Opened from Print with a DEVNAMES but no DEVMODE, Options is disabled and the driver not loaded. Otherwise the program's DEVNAMES checked, the printer found as Print finds it (the same box without a default), its driver loaded, and a working DEVMODE made: the driver's default, or a copy of the program's.
3. The sizes and sources filled (`1d7c`, `2026`), the Paper group enabled where either has items; the orientation enabled where the driver can turn the page, and Portrait or Landscape checked by `dmOrientation`, the icon 528 or 529 put in 43Ch (`236a`, `1bea`). Options enabled where the driver has `AdvancedSetupDialog` or `ExtDeviceMode`. Without a working DEVMODE, the orientation and paper are disabled and emptied (`1c5e`).
4. The printers listed (`07ad`), and "(currently `<default>`)" written in 440h from string 446h. With no printers at all, `PDERR_NODEVICES`; with no default, Default Printer disabled.
5. The program's printer found in the list (`248a`); not there and not the default, `PDERR_PRINTERNOTFOUND`. Default Printer or Specific Printer checked by `DN_DEFAULTPRN`; for a specific printer the list gets a tab stop; the printer chosen.
6. On Windows 3.10 the three lists get the extended UI, and the printers' list is subclassed with [[fn:COMMDLG.dwUpArrowHack]].
7. Help hidden and disabled without `PD_SHOWHELP`; the setup hook given `WM_INITDIALOG`, or 1.

[[measured]] Default Printer checked, the list on `LPT1:` without a tab stop, "(currently Apple LaserWriter Plus on LPT1:)", Portrait; seven sizes from "Letter 8 1/2 x 11 in" to "Note 8 1/2 x 11 in", Letter chosen; sources "Upper Tray" and "Manual Feed".

### The sizes and sources

- [[read out]] A paper size of 256 or less is named by COMMDLG's string 480h plus its number — 481h "Letter 8 1/2 x 11 in" to 4A9h "German Legal Fanfold 8 1/2 x 13 in", 580h "User Defined Size" — and one it has no string for is left out; above 256, the driver's `DC_PAPERNAMES` name is used, if it has names. Each item's data is the size; `dmPaperSize`'s is chosen.
- [[read out]] A source is named by the driver, 24 characters each; its data the bin's number, `dmDefaultSource`'s chosen, else the first.

### What the controls do

- [[read out]] **Default Printer** and **Specific Printer** (`35be`): the list loses or gains its tab stop, and Specific moves the focus to it. Choosing the other one, the printer is taken again (`2c62`): its driver loaded, the working DEVMODE asked for again, the sizes, sources and orientation filled. A driver that will not load disables the orientation, paper and Options, and OK then refuses with string 45Bh, "`<device>` driver file `<driver>` not found. Please reinstall through Control Panel or choose another printer.", keeping the dialog.
- [[read out]] **The printers' list**: getting the focus checks Specific Printer; a new choice, made with the list closed or as it closes, checks Specific Printer and takes the printer again.
- [[read out]] **Portrait** and **Landscape** check themselves and change the icon.
- [[read out]] **Options...** writes the orientation and paper into the working DEVMODE, then calls the driver's `AdvancedSetupDialog`, or `ExtDeviceMode` with `DM_PROMPT | DM_COPY | DM_MODIFY`; answered `IDOK`, the lists and orientation are filled again from it, and the focus goes to OK. [[measured]] [[probe:prdlgx]]: the PostScript driver has no `AdvancedSetupDialog`, and its `ExtDeviceMode` put up its own dialog, "Options", with Advanced..., Send Header..., Help, Print To, Margins, Scaling, Color, Send Header with Each Job and Duplex Printing; its OK left Print Setup's printer, Portrait and lists as they were.
- [[read out]] **OK** (`31fd`): the printer chosen — for Default Printer, the default's DEVNAMES made afresh — replaces `hDevNames`, and the others are freed (`2a7a`); its driver loaded once more; the working DEVMODE, with the orientation, size and source written into it (`2b43`), replaces `hDevMode`; `hDC` nought; and, with `PD_PRINTSETUP` and `PD_RETURNDC` or `PD_RETURNIC`, the DC or IC made (`2bdb`).
- [[read out]] **Cancel** frees the working DEVMODE, and with `PD_PRINTSETUP` a DEVNAMES COMMDLG made.
- [[read out]] A `WM_COMMAND` of 3 ends the dialog with its `lParam`'s low word, as Print's; one of 4 takes the structure's printer and DEVMODE again, as the dialog started (`33c8`). [[measured]] [[probe:prdlgx]], in Print Setup alone with the second printer and Landscape chosen: 4 answered nought and put back Default Printer on `LPT1:`, and, the structure having no DEVMODE, disabled the orientation and emptied the sizes and sources (`3496`); 3 with `lParam` 7 ended it, `PrintDlg` answering 7 and leaving no DEVNAMES and no DEVMODE. In the Print dialog, 3 with 5 made `PrintDlg` answer 5, its DEVNAMES and DEVMODE left as they were, `wDefault` C001h.
- [[measured]] Specific Printer by its mnemonic: checked, the list with the focus and a tab stop. The second printer chosen and Landscape: OK answered 1 with a DEVNAMES of `LPT2:`, `wDefault` nought, and `dmOrientation` 2. Help sent the owner `HELPMSGSTRING`'s message with the dialog and the structure. Cancel answered nought, and the DEVNAMES COMMDLG had made was freed: `hDevNames` nought.

## Hooks

- [[read out]] Each procedure gives its hook, found through the property, each message first, and answers what it answers that is not nought (`3757`, `30b1`). Before the property is there, the hook `PrintDlg` kept is given every message but `WM_INITDIALOG`, which clears it.
- [[read out]] Setup opened from Print gets no such hook, and as it ends, its procedure keeps the setup hook again where `PD_ENABLESETUPHOOK` is set (`3397`): the Print dialog's procedure then gives that hook every message of the Print dialog its own hook leaves, until `PrintDlg` returns. Print's procedure does the same with its own hook as it ends (`3b84`).
- [[measured]] The print hook was given `WM_SETFONT` before its `WM_INITDIALOG`, whose `lParam` is the structure; the setup hook, opened from Print, nothing before. After Setup closed, the setup hook was given the Print dialog's messages. Hooks given without their flags were written nought.

## Errors

[[read out]] Every error `PrintDlg` sets, and where; [[measured]] marks the ones [[probe:prdlg]] produced.

| Error                      | Value | Set where                                                                                                             |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `CDERR_STRUCTSIZE`         | 1     | `lStructSize` not 34h (`0cc7`); [[measured]]                                                                          |
| `CDERR_NOTEMPLATE`         | 3     | a template asked for by name with no name (`0e64`); [[measured]]                                                      |
| `CDERR_NOHINSTANCE`        | 4     | a named template with no instance (`0e74`); [[measured]]                                                              |
| `CDERR_LOADSTRFAILURE`     | 5     | string 441h or 446h not loaded (`14ef`, `0977`)                                                                       |
| `CDERR_LOADRESFAILURE`     | 7     | a named template not found or not loaded (`0ec0`); [[measured]]                                                       |
| `CDERR_LOCKRESFAILURE`     | 8     | the template not locked (`0f69`); [[measured]] with a handle of nought                                                |
| `CDERR_MEMALLOCFAILURE`    | 9     | a DEVNAMES or a dialog's memory not allocated (`014f`, `13a3`, `1771`, `2583`)                                        |
| `CDERR_MEMLOCKFAILURE`     | 0Ah   | a DEVNAMES or DEVMODE not locked (ten places, `0c62` to `336d`)                                                       |
| `CDERR_NOHOOK`             | 0Bh   | a hook asked for and not given (`17ae`, `25c0`); [[measured]] print, setup, and setup in Print                        |
| `CDERR_DIALOGFAILURE`      | FFFFh | the dialog not made (`0f9e`)                                                                                          |
| `PDERR_SETUPFAILURE`       | 1001h | the icons or strings of the first call not loaded (`0cdd`)                                                            |
| `PDERR_PARSEFAILURE`       | 1002h | `device=` or a `[devices]` value without a comma (`01a3`, `130d`); [[measured]]                                       |
| `PDERR_RETDEFFAILURE`      | 1003h | `PD_RETURNDEFAULT` with a DEVMODE or DEVNAMES given (`0d1e`); [[measured]]                                            |
| `PDERR_LOADDRVFAILURE`     | 1004h | the driver not loaded (`0dd6`, `18b3`, `26ff`)                                                                        |
| `PDERR_GETDEVMODEFAIL`     | 1005h | the driver gave no DEVMODE (`18f6`, `278c`)                                                                           |
| `PDERR_INITFAILURE`        | 1006h | a dialog's `WM_INITDIALOG` failed with no other error (`19a2`, `27da`)                                                |
| `PDERR_NODEVICES`          | 1007h | a DEVMODE's device not in `[devices]` (`12e0`), or no printers and no default (`0a48`); [[measured]] the first        |
| `PDERR_NODEFAULTPRN`       | 1008h | no `device=` (`011f`, `0a34`); [[measured]]                                                                           |
| `PDERR_CREATEICFAILURE`    | 100Ah | the Print dialog's IC of the printer not made (`172b`)                                                                |
| `PDERR_PRINTERNOTFOUND`    | 100Bh | a DEVNAMES WIN.INI does not have (`0abf`), or not in Print Setup's list (`293f`); [[measured]] the first              |
| `PDERR_DEFAULTDIFFERENT`   | 100Ch | `DN_DEFAULTPRN` on a printer not the default (`0c38`); after Print Setup from Print, set again (`3c87`); [[measured]] |
| `PDERR_PRINTERCODES` 1000h |       | not set by `COMMDLG.DLL` 3.1                                                                                          |
| `PDERR_DNDMMISMATCH` 1009h |       | not set; only compared after Print Setup from Print (`3c63`)                                                          |

[[read out]] The error is cleared once a program's DEVNAMES has passed its check (`0cfd`), so a refusal before it — the size, the first call's setup, the DEVNAMES itself — leaves its own code, and one after starts from nought. A dialog that fails ends with nought and its error; a dialog that succeeds or is cancelled leaves nought. [[measured]] Every call that reached a dialog left nought.

## In WinBox

- `PrintDlg`, `PrintDlgProc`, `PrintSetupDlgProc`, `EditIntegerOnly` and `dwUpArrowHack` are WinBox's own, with `COMMDLG.DLL` on the drive or without it: `print_dlg.rs`, `print_proc.rs` and `print_setup.rs` in `crates/winbox-win16/src/commdlg/`, and `print-dlg.ts`, `print-proc.ts` and `print-setup.ts` in `src/win16/commdlg/`. Each step above is followed at its address. Templates 1538 and 1539 and icons 528 and 529 are WinBox's own, built in (`print_resources.rs`, `print-resources.ts`).
- Every call into USER, GDI and KERNEL is made as COMMDLG makes it, through `api.rs` and `api.ts`: `GetProfileString` for the printers, `LoadLibrary` and `GetProcAddress` for the driver, `CreateIC` and `Escape` for its copies, `DialogBoxIndirectParam` with COMMDLG's instance and its own exports as the procedures. The driver's `ExtDeviceMode`, `DeviceCapabilities` and `AdvancedSetupDialog` are called at the addresses `GetProcAddress` gives, with COMMDLG's data segment, and the driver's own code runs, its Options dialog too.
- The count of print calls in progress and whether the driver's entries' names are read are kept beside COMMDLG's data, and start again as `COMMDLG.DLL` is loaded afresh (`loader.rs`, `library.ts`), as the file's data does: so a size refused as COMMDLG's first print call leaves the names unread until the library is let go of. Without the file, WinBox's COMMDLG is never let go of, and they stay unread.
- Not followed: each dialog's six bytes of COMMDLG's local memory are kept in WinBox's, a number under the property A000h, as the other dialogs keep theirs ([[topic:common-dialogs]]); COMMDLG's strings are WinBox's own, so `CDERR_LOADSTRFAILURE` is never set; a profile line is parsed a byte at a time, where COMMDLG steps with `AnsiNext`.
- [[measured]] [[probe:prdlg]] and [[probe:prdlgx]] run whole on both engines, with `COMMDLG.DLL` and with `vgaprint`'s PostScript driver put on the drive for them (`run-probe.ts`, `support/mod.rs`), GDI making the printer's IC and DC of the driver ([[topic:printing]]): every record agrees on each, 376 and 204 — the refusals, the no-printer cases and their box, the driver's own answers and its Options dialog, `PD_RETURNDEFAULT`, the refused size before the first call, both dialogs with their controls, boxes, hooks, keys and results, the program's templates, `WM_COMMAND` 3 and 4, Setup...'s loop, and the DC on `FILE:`.
- Notepad's, Write's and Paintbrush's Print Setup and Write's Print dialog, with the printer on the drive, run with `COMMDLG.DLL` and without it (`print_dialogs_test.ts`, `print_dialogs.rs`): the printer, its sizes and sources, Landscape kept from one opening to the next; the Print dialog's printer line, quality and copies.

## Not yet done

- Not recorded: a driver without `ExtDeviceMode`, or of a DEVMODE before 30Ah, and the escapes COMMDLG asks it for its sources; network ports; `WM_MEASUREITEM` for an owner-drawn control of a program's template.
- The dialogs' pixels are not recorded.
