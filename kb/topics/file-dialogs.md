---
kind: topic
name: File dialogs
summary: COMMDLG's Open and Save As boxes — the OPENFILENAME structure, the two templates, the procedures and subclasses, the lists DOS fills, the folders' and drives' pictures, the messages a box shows for DOS's errors — and how WinBox makes them its own.
probes: [ofnopen, ofnerr, ftitle]
---

[[fn:COMMDLG.GetOpenFileName]] and [[fn:COMMDLG.GetSaveFileName]] run the one modal box under two captions; [[fn:COMMDLG.GetFileTitle]] gives a name's last part with the parser the boxes check a name with. Nearly every accessory uses them. Every address on this page is in `COMMDLG.DLL` seg2. What all the common dialogs share is in [[topic:common-dialogs]].

## The structure

`OPENFILENAME`, 72 bytes. [[documented]] Its fields, at the offsets [[read out]] the code reads them at (`lpstrFile` 18h, `Flags` 30h, `lpfnHook` 40h; seg2 `3316`, `4523`, `44b6`):

| Offset | Field               | Offset | Field            |
| ------ | ------------------- | ------ | ---------------- |
| 0      | `lStructSize`       | 2Ch    | `lpstrTitle`     |
| 4      | `hwndOwner`         | 30h    | `Flags`          |
| 6      | `hInstance`         | 34h    | `nFileOffset`    |
| 8      | `lpstrFilter`       | 36h    | `nFileExtension` |
| 0Ch    | `lpstrCustomFilter` | 38h    | `lpstrDefExt`    |
| 10h    | `nMaxCustFilter`    | 3Ch    | `lCustData`      |
| 14h    | `nFilterIndex`      | 40h    | `lpfnHook`       |
| 18h    | `lpstrFile`         | 44h    | `lpTemplateName` |
| 1Ch    | `nMaxFile`          |        |                  |
| 20h    | `lpstrFileTitle`    |        |                  |
| 24h    | `nMaxFileTitle`     |        |                  |
| 28h    | `lpstrInitialDir`   |        |                  |

[[documented]] The flags: `OFN_READONLY` 1, `OFN_OVERWRITEPROMPT` 2, `OFN_HIDEREADONLY` 4, `OFN_NOCHANGEDIR` 8, `OFN_SHOWHELP` 10h, `OFN_ENABLEHOOK` 20h, `OFN_ENABLETEMPLATE` 40h, `OFN_ENABLETEMPLATEHANDLE` 80h, `OFN_NOVALIDATE` 100h, `OFN_ALLOWMULTISELECT` 200h, `OFN_EXTENSIONDIFFERENT` 400h, `OFN_PATHMUSTEXIST` 800h, `OFN_FILEMUSTEXIST` 1000h, `OFN_CREATEPROMPT` 2000h, `OFN_SHAREAWARE` 4000h, `OFN_NOREADONLYRETURN` 8000h, `OFN_NOTESTFILECREATE` 10000h. [[read out]] COMMDLG keeps three bits of its own, 70000000h, which the box clears as it starts (seg2 `1153`); bit 40000000h marks a folder chosen in the folders' list for OK to open ([[fn:COMMDLG.dwOKSubclass]]).

## The templates

[[read out]] Dialog 1536 is the box, 264 × 134 in 8-point "Helv", captioned "Open"; 1537, for `OFN_ALLOWMULTISELECT`, is the same but for its files' list, which has `LBS_EXTENDEDSEL`, and a few rows moved by a dialog unit. Their controls: "File &Name:" (442h) and its edit (480h); the files' list (460h); "&Directories:" (FFFFh), the folder's name (440h) and the folders' list (461h); "List Files of &Type:" (441h) and its combo box (470h); "Dri&ves:" (443h) and its combo box (471h); OK, Cancel, "&Help" (40Eh) and "&Read Only" (410h). The folders' and drives' lists are owner-drawn.

[[read out]] Save As uses the same templates; [[fn:COMMDLG.FileSaveDlgProc]] sets the caption to string 181h, "Save As", and the types' label to 182h, "Save File as &Type:", unless the program gave its own template.

## The procedures and subclasses

- [[fn:COMMDLG.FileOpenDlgProc]] and [[fn:COMMDLG.FileSaveDlgProc]] are the boxes' procedures: the program's hook first, before `WM_INITDIALOG` too, then the box's own code.
- [[fn:COMMDLG.dwLBSubclass]] and [[fn:COMMDLG.dwOKSubclass]] subclass the folders' list and OK, so that a folder selected in the list stays selected only while the focus goes to OK.
- [[read out]] The box's block, 40Dh bytes of COMMDLG's local memory, is under the box's property A000h; its first doubleword is the program's structure (seg2 `1153`).

## The lists and DOS

[[read out]] The files' and folders' lists are filled by DOS searches, one for each pattern between `;`s, through COMMDLG's own small DOS helpers rather than through KERNEL's functions:

| Entry                     | DOS function                                     |
| ------------------------- | ------------------------------------------------ |
| [[fn:COMMDLG.Ordinal 38]] | 4Eh, find first                                  |
| [[fn:COMMDLG.Ordinal 41]] | 4Fh, find next                                   |
| [[fn:COMMDLG.Ordinal 39]] | 2Fh and 1Ah, the disk transfer area set and kept |
| [[fn:COMMDLG.Ordinal 40]] | 1Ah, the area put back                           |
| [[fn:COMMDLG.Ordinal 44]] | 19h, the current drive                           |
| [[fn:COMMDLG.Ordinal 50]] | 0Eh, the drive selected                          |
| [[fn:COMMDLG.Ordinal 51]] | 19h and 47h, the current directory as a path     |
| [[fn:COMMDLG.Ordinal 52]] | 3Bh, the directory changed                       |
| [[fn:COMMDLG.Ordinal 49]] | 11h with an extended FCB, a volume label         |
| [[fn:COMMDLG.Ordinal 45]] | 4300h, a file's attributes                       |
| [[fn:COMMDLG.Ordinal 47]] | 5Ah, a temporary file, for Save As's check       |
| [[fn:COMMDLG.Ordinal 46]] | 59h, the extended error                          |

## The folders' and drives' pictures

[[read out]] Bitmap 576, 128 × 16 pixels in 16 colours, holds the folders' and drives' pictures side by side. [[fn:COMMDLG.Ordinal 42]] makes of it a strip twice as wide, with [[fn:COMMDLG.LoadAlterBitmap]]: on the left its pure blue made the window's colour, on the right the highlight's. [[inferred]] A row draws its picture from the half that matches its background, selected or not. It makes the strip as a box is first used and again for `WM_SYSCOLORCHANGE`, and only where the two colours have changed.

## When DOS refuses

[[read out]] A box shows DOS's errors in a message box with the box's caption, `MB_ICONEXCLAMATION` (seg2 `1a26`). The text is one of COMMDLG's strings, chosen by DOS's error code, with the name, or the drive's letter, put in it. [[documented]] The codes' meanings are DOS's; 60h to 63h are not DOS's codes.

| DOS's error            | String                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| 2, file not found      | 187h, "%s Cannot find this file. Please verify that the correct path..." |
| 3, path not found      | 188h, "%s Path does not exist..."                                        |
| 4, too many open files | 191h, "%s Too many files already open..."                                |
| 5, access denied       | 184h, "Cannot read drive %c:..."                                         |
| 13h, write-protected   | 18Fh, "Disk %c: is write-protected..."                                   |
| 20h, sharing violation | 18Ah, "%s This file is already in use..."                                |
| 41h, network access    | 18Bh, "%s Cannot access this file..."                                    |
| 52h, cannot make       | 190h, "Not enough disk space on drive %c:..."                            |
| 53h, critical error    | 18Dh, "%s DOS critical error..."                                         |
| 60h                    | 193h, "...network drive with create but no modify privileges..."         |
| 61h                    | 183h, "Drive %c: does not exist..."                                      |
| 62h                    | 18Eh, "%s This filename is a reserved device name..."                    |
| 63h                    | 18Ch, "%s This file exists and is read-only..."                          |
| anything else          | 189h, "%s This filename is not valid."                                   |

[[read out]] A name longer than 256 is cut there first. After "This filename is not valid." the focus goes back to the name, with `WM_NEXTDLGCTL` posted. [[measured]] [[probe:ofnopen]] shows 187h and 189h; string 184h it shows for a drive with no disk in a box of its own, with Retry and Cancel ([[fn:COMMDLG.GetOpenFileName]]).

## WinBox's own

The file dialogs are WinBox's own, with [[fn:COMMDLG.GetFileTitle]] and [[fn:COMMDLG.CommDlgExtendedError]]. [[probe:ofnopen]], [[probe:ofnerr]] and [[probe:ftitle]] record them, and both engines agree with all their records.

- **The templates are WinBox's own**: Open and Save As's box, 1536, and the box for several files, 1537, built into the engines with COMMDLG's strings. A program's template, named or by handle, is used in their place as COMMDLG uses one.
- **The procedures** are WinBox's stubs for entries 6 and 7, `FileOpenDlgProc` and `FileSaveDlgProc`, and the subclasses of the folders' list and OK are entries 29 and 31, `dwLBSubclass` and `dwOKSubclass`. A program that asks [[fn:KERNEL.GetProcAddress]] for them gets those.
- **The hook** is called before COMMDLG's own code for every message, as the file calls it, and is sent what comes before `WM_INITDIALOG` too.
- **Each call into KERNEL, USER and GDI** is made as the file makes it: its arguments pushed below the stack, its strings and structures laid out below them, and the function that answers a program's call run (`api.ts`, `api.rs`). So the lists are filled, the boxes put up and the rows drawn by USER as they would be for the file, and USER's own quirks show in WinBox's dialogs as in COMMDLG's.
- **The folders' and drives' pictures** are bitmap 576 of the installation's `COMMDLG.DLL`, read as data and made into the same strip. With no file there are none; the rows keep their height.
- **Without `COMMDLG.DLL`** on the drive, Notepad's Open does all it does with the file: `test/win16/file_dialogs_test.ts` and `crates/winbox-web/tests/file_dialogs.rs`.
- The code: `src/win16/commdlg/file-dialogs.ts`, `file-init.ts`, `file-command.ts`, `file-ok.ts`, `file-lists.ts`, `pictures.ts`, `parse-file.ts`; `crates/winbox-win16/src/commdlg/file_dialogs.rs`, `file_init.rs`, `file_command.rs`, `file_ok.rs`, `file_lists.rs`, `pictures.rs`, `parse.rs`.

Fixing USER and DOS for the probes: a dialog's controls are made with `WS_EX_NOPARENTNOTIFY` ([[topic:dialog-boxes]]); a combo box lays itself out again for `WM_SETFONT`, and has `CBS_HASSTRINGS` in its style ([[topic:combo-boxes]]); a list box or combo box draws as it changes only where it and every window above it are visible; DOS's function 47h fails on a drive with no disk ([[topic:drives-and-disks]]).

## Not yet done

- A box's block is kept by its window, not by `SetProp` A000h as the file keeps it: a hook that reads the property finds nothing.
- Save As's checks, `OFN_ALLOWMULTISELECT`, `SHAREVISTRING`, `HELPMSGSTRING`, network drives and CD-ROM drives are read out and followed but not recorded.
- The box's screen is not recorded: DOSBox's screenshot of it came out black.
