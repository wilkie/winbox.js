---
kind: topic
name: Common dialogs
summary: COMMDLG, Windows 3.1's common dialogs, made WinBox's own a function at a time — what the library holds, how a call reaches WinBox's code or the file's, its registered messages, every extended error, hooks and templates, its resources — read out of COMMDLG.DLL.
probes: [loadpath, ofnopen, ofnerr, ftitle, findrepl, choosclr, chfont, prdlg]
---

`COMMDLG.DLL` holds Windows 3.1's common dialogs: Open and Save As, Find and Replace, Color, Font and Print. Programs import it by name, or load it with [[fn:KERNEL.LoadLibrary]], as WinHelp does. WinBox makes it its own a function at a time. A function not yet made its own stays the file's code while the drive has `COMMDLG.DLL` ([[topic:dynamic-link-libraries]]).

Each dialog has a topic of its own:

- [[topic:file-dialogs]]: [[fn:COMMDLG.GetOpenFileName]], [[fn:COMMDLG.GetSaveFileName]] and [[fn:COMMDLG.GetFileTitle]].
- [[topic:find-and-replace]]: [[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ReplaceText]].
- [[topic:choose-color]]: [[fn:COMMDLG.ChooseColor]].
- [[topic:choose-font]]: [[fn:COMMDLG.ChooseFont]].
- [[topic:print-dialogs]]: [[fn:COMMDLG.PrintDlg]].

## What the library holds

[[read out]] Nine segments: one for each dialog's code, two for starting, one of data.

| Segment | What                                                                   |
| ------- | ---------------------------------------------------------------------- |
| seg1    | Color, and at its end the file dialogs' small DOS and memory helpers   |
| seg2    | Open and Save As, the file-name parser, [[fn:COMMDLG.GetFileTitle]]    |
| seg3    | Print and Print Setup                                                  |
| seg4    | Font                                                                   |
| seg5    | Find and Replace                                                       |
| seg6    | [[fn:COMMDLG.LoadAlterBitmap]], [[fn:COMMDLG.WEP]], the extended error |
| seg7    | `LibMain` ([[fn:COMMDLG.Ordinal 53]]), which registers the messages    |
| seg8    | the entry point, which calls `LocalInit` and `LibMain`                 |
| seg9    | the data segment, its local heap 400h bytes                            |

[[read out]] The entry table names 26 exports, flags 3. Entries 32 to 53 have no names and flags 0: they are not offered to programs but are the entries the linker gave COMMDLG's own far calls into its moveable segments, each called through a relocation naming its ordinal.

| Ordinal | Export                              | What                                                   | WinBox's own |
| ------- | ----------------------------------- | ------------------------------------------------------ | ------------ |
| 1       | [[fn:COMMDLG.GetOpenFileName]]      | the Open box                                           | yes          |
| 2       | [[fn:COMMDLG.GetSaveFileName]]      | the Save As box                                        | yes          |
| 5       | [[fn:COMMDLG.ChooseColor]]          | the Color dialog                                       | yes          |
| 6       | [[fn:COMMDLG.FileOpenDlgProc]]      | Open's procedure                                       | yes          |
| 7       | [[fn:COMMDLG.FileSaveDlgProc]]      | Save As's procedure                                    | yes          |
| 8       | [[fn:COMMDLG.ColorDlgProc]]         | Color's procedure                                      | yes          |
| 9       | [[fn:COMMDLG.LoadAlterBitmap]]      | a bitmap of COMMDLG's with one colour changed          | no           |
| 11      | [[fn:COMMDLG.FindText]]             | the Find dialog                                        | yes          |
| 12      | [[fn:COMMDLG.ReplaceText]]          | the Replace dialog                                     | yes          |
| 13      | [[fn:COMMDLG.FindTextDlgProc]]      | Find's procedure                                       | yes          |
| 14      | [[fn:COMMDLG.ReplaceTextDlgProc]]   | Replace's procedure                                    | yes          |
| 15      | [[fn:COMMDLG.ChooseFont]]           | the Font dialog                                        | yes          |
| 16      | [[fn:COMMDLG.FormatCharDlgProc]]    | Font's procedure                                       | yes          |
| 18      | [[fn:COMMDLG.FontStyleEnumProc]]    | Font's enumeration of a family's styles                | yes          |
| 19      | [[fn:COMMDLG.FontFamilyEnumProc]]   | Font's enumeration of the families                     | yes          |
| 20      | [[fn:COMMDLG.PrintDlg]]             | the Print and Print Setup dialogs                      | yes          |
| 21      | [[fn:COMMDLG.PrintDlgProc]]         | Print's procedure                                      | yes          |
| 22      | [[fn:COMMDLG.PrintSetupDlgProc]]    | Print Setup's procedure                                | yes          |
| 23      | [[fn:COMMDLG.EditIntegerOnly]]      | Print's subclass of its number fields                  | yes          |
| 25      | [[fn:COMMDLG.WantArrows]]           | Color's subclass of its grids                          | yes          |
| 26      | [[fn:COMMDLG.CommDlgExtendedError]] | why the last dialog failed                             | yes          |
| 27      | [[fn:COMMDLG.GetFileTitle]]         | a file name's last part                                | yes          |
| 28      | [[fn:COMMDLG.WEP]]                  | the exit procedure                                     | no           |
| 29      | [[fn:COMMDLG.dwLBSubclass]]         | the file boxes' subclass of the folders' list          | yes          |
| 30      | [[fn:COMMDLG.dwUpArrowHack]]        | Print Setup's subclass                                 | yes          |
| 31      | [[fn:COMMDLG.dwOKSubclass]]         | the file boxes' subclass of OK                         | yes          |
| 32      | [[fn:COMMDLG.Ordinal 32]]           | the wait cursor                                        | no           |
| 33–37   | [[fn:COMMDLG.Ordinal 33]] …         | what each dialog's segment frees at [[fn:COMMDLG.WEP]] | no           |
| 38–52   | [[fn:COMMDLG.Ordinal 38]] …         | DOS, memory and bitmap helpers of the file dialogs     | no           |
| 53      | [[fn:COMMDLG.Ordinal 53]]           | `LibMain`                                              | no           |

The unnamed entries in full: [[fn:COMMDLG.Ordinal 33]] Find and Replace's, [[fn:COMMDLG.Ordinal 34]] Font's, [[fn:COMMDLG.Ordinal 35]] Color's, [[fn:COMMDLG.Ordinal 36]] Print's and [[fn:COMMDLG.Ordinal 37]] the file dialogs' frees; [[fn:COMMDLG.Ordinal 42]] the folders' pictures and [[fn:COMMDLG.Ordinal 43]] an object given to COMMDLG; [[fn:COMMDLG.Ordinal 48]], a far memory move; and the DOS helpers [[fn:COMMDLG.Ordinal 38]], [[fn:COMMDLG.Ordinal 39]], [[fn:COMMDLG.Ordinal 40]], [[fn:COMMDLG.Ordinal 41]], [[fn:COMMDLG.Ordinal 44]], [[fn:COMMDLG.Ordinal 45]], [[fn:COMMDLG.Ordinal 46]], [[fn:COMMDLG.Ordinal 47]], [[fn:COMMDLG.Ordinal 49]], [[fn:COMMDLG.Ordinal 50]], [[fn:COMMDLG.Ordinal 51]] and [[fn:COMMDLG.Ordinal 52]] ([[topic:file-dialogs]]).

## One COMMDLG, two codes

- With the file, the program gets the file's library: its module handle and instance, its count, and its entry point. An import of an export WinBox answers is linked to WinBox's stub for that ordinal instead of the file's entry, and [[fn:KERNEL.GetProcAddress]] answers the stub.
- Without the file, every import is WinBox's stub. An export WinBox does not answer yet answers nought, as a stub does. [[fn:KERNEL.LoadLibrary]] finds `COMMDLG.DLL` by its name whether or not the file is there.
- A dialog WinBox makes is made with `COMMDLG`'s instance, and its procedure is WinBox's stub for the export the file would have used, called by USER as any procedure is.
- Inside the file nothing changes: its own calls between its functions, and to its unnamed entries, stay its own.
- [[read out]] While it works, `COMMDLG` sets the hourglass, and the arrow when it is done ([[fn:COMMDLG.Ordinal 32]], seg2 `08e2`). It sets neither while its Open or Save dialog is being made (`[0CACh]`, seg2 `4354`). Where no mouse was present as it loaded, it also shows and hides the cursor. WinBox always has a mouse.

## Registered messages

[[read out]] `LibMain` registers five messages, in this order, as COMMDLG loads (seg7 `010b` to `014c`), and once it has made its memory device context a sixth (seg7 `0208`); `FindText` and `ReplaceText` register a seventh each time they are called (seg5 `0089`, `0259`):

| Name                         | Constant        | Kept at   | Used by                                                          |
| ---------------------------- | --------------- | --------- | ---------------------------------------------------------------- |
| `commdlg_LBSelChangedNotify` | `LBSELCHSTRING` | `[0D1Ch]` | the file boxes: the hook told of a selection in a list           |
| `commdlg_ShareViolation`     | `SHAREVISTRING` | `[0A96h]` | the file boxes: the hook told of a file another program has open |
| `commdlg_FileNameOK`         | `FILEOKSTRING`  | `[0A90h]` | the file boxes: the hook asked about the name chosen             |
| `commdlg_ColorOK`            | `COLOROKSTRING` | `[0AA0h]` | Color: the hook asked about the colour chosen                    |
| `commdlg_SetRGBColor`        | `SETRGBSTRING`  | `[0CF0h]` | Color: sent to the dialog to choose a colour                     |
| `commdlg_help`               | `HELPMSGSTRING` | `[0A98h]` | every dialog's Help button: the owner told                       |
| `commdlg_FindReplace`        | `FINDMSGSTRING` | `[0780h]` | Find and Replace: the owner told of each search                  |

Without the file, WinBox registers the first six as `COMMDLG` loads, in the same order. A message registered again keeps its number, so a program that registers one by its name gets the number `COMMDLG` uses.

## The extended error

[[read out]] [[fn:COMMDLG.CommDlgExtendedError]] answers a doubleword `COMMDLG` keeps, `[2CCh]` in its data (seg6 `01f1`), and changes nothing. Each function sets it as it fails. WinBox keeps the one doubleword: the file's while the file is loaded, found from the file's own `CommDlgExtendedError`, and its own otherwise, so the error reads the same whichever code failed last.

[[documented]] The codes' names and meanings are the SDK's. [[read out]] Where each is set is read from every store to `[2CCh]` in the file; a code no store names is never set.

| Code  | Name                     | Meaning                                          | Set by, `COMMDLG.DLL`                                                                                                                                                                                                                          |
| ----- | ------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | —                        | no error                                         | Open and Save As as they start (seg2 `0a2c`); Font as it starts, before its size is checked (seg4 `0021`); Print once a program's `DEVNAMES` has passed its check (seg3 `0cfd`); Find and Replace once their checks pass (seg5 `0136`, `0307`) |
| FFFFh | `CDERR_DIALOGFAILURE`    | the dialog could not be made                     | Open, Save As (seg2 `0bb8`); Color (seg1 `0ff5`); Font (seg4 `0138`); Print (seg3 `0f9e`)                                                                                                                                                      |
| 1     | `CDERR_STRUCTSIZE`       | the structure's size is wrong                    | Open, Save As (seg2 `0a0f`); Find (seg5 `002a`); Replace (seg5 `01c6`); Font (seg4 `0038`); Print (seg3 `0cc7`) — not Color                                                                                                                    |
| 2     | `CDERR_INITIALIZATION`   | the dialog could not be set up                   | never                                                                                                                                                                                                                                          |
| 3     | `CDERR_NOTEMPLATE`       | a template asked for and not named               | Open, Save As (seg2 `0a83`); Color (seg1 `0f17`); Print (seg3 `0e64`)                                                                                                                                                                          |
| 4     | `CDERR_NOHINSTANCE`      | a template asked for with no instance            | Open, Save As (seg2 `0a9f`); Color (seg1 `0f3e`); Print (seg3 `0e74`)                                                                                                                                                                          |
| 5     | `CDERR_LOADSTRFAILURE`   | a string of COMMDLG's would not load             | Replace (seg5 `024b`); Font (seg4 `03e2`); Print (seg3 `0977`, `14ef`)                                                                                                                                                                         |
| 6     | `CDERR_FINDRESFAILURE`   | a template was not found                         | Open, Save As (seg2 `0b17`); Color (seg1 `0fa4`); Find (seg5 `00c2`); Replace (seg5 `0293`); Font (seg4 `0082`)                                                                                                                                |
| 7     | `CDERR_LOADRESFAILURE`   | a resource would not load                        | Open, Save As (seg2 `0b3c`, and seg2 `0a3d` for the pictures); Color (seg1 `0fbd`); Find, Replace (seg5 `00df`, `02b0`); Font (seg4 `009e`); Print, for a template not found as well (seg3 `0ec0`)                                             |
| 8     | `CDERR_LOCKRESFAILURE`   | a resource would not lock                        | Find, Replace (seg5 `0186`, `0357`); Print (seg3 `0f69`)                                                                                                                                                                                       |
| 9     | `CDERR_MEMALLOCFAILURE`  | memory could not be had                          | Open, Save As (seg2 `1174`); Font (seg4 `0434`); Print (seg3 `014f`, `13a3`, `1771`, `2583`)                                                                                                                                                   |
| 0Ah   | `CDERR_MEMLOCKFAILURE`   | memory would not lock                            | Print (seg3 `0c62` and nine more)                                                                                                                                                                                                              |
| 0Bh   | `CDERR_NOHOOK`           | a hook asked for and not given                   | Open, Save As (seg2 `133c`); Color (seg1 `0ed9`); Find, Replace (seg5 `0072`, `021f`); Font (seg4 `0058`); Print (seg3 `17ae`, `25c0`)                                                                                                         |
| 0Ch   | `CDERR_REGISTERMSGFAIL`  | a message would not register                     | Find, Replace (seg5 `0095`, `0265`)                                                                                                                                                                                                            |
| 1000h | `PDERR_PRINTERCODES`     | the printer driver's own error                   | never                                                                                                                                                                                                                                          |
| 1001h | `PDERR_SETUPFAILURE`     | Print could not be set up                        | Print (seg3 `0cdd`)                                                                                                                                                                                                                            |
| 1002h | `PDERR_PARSEFAILURE`     | a printer's profile line could not be read       | Print (seg3 `01a3`, `130d`)                                                                                                                                                                                                                    |
| 1003h | `PDERR_RETDEFFAILURE`    | `PD_RETURNDEFAULT` with handles given            | Print (seg3 `0d1e`)                                                                                                                                                                                                                            |
| 1004h | `PDERR_LOADDRVFAILURE`   | the printer's driver would not load              | Print (seg3 `0dd6`, `18b3`, `26ff`)                                                                                                                                                                                                            |
| 1005h | `PDERR_GETDEVMODEFAIL`   | the driver gave no `DEVMODE`                     | Print (seg3 `18f6`, `278c`)                                                                                                                                                                                                                    |
| 1006h | `PDERR_INITFAILURE`      | the dialog could not be set up                   | Print (seg3 `19a2`, `27da`)                                                                                                                                                                                                                    |
| 1007h | `PDERR_NODEVICES`        | no printer is installed                          | Print (seg3 `0a48`, `12e0`)                                                                                                                                                                                                                    |
| 1008h | `PDERR_NODEFAULTPRN`     | no default printer                               | Print (seg3 `011f`, `0a34`)                                                                                                                                                                                                                    |
| 1009h | `PDERR_DNDMMISMATCH`     | `DEVNAMES` and `DEVMODE` name different printers | never: Print compares the error with it (seg3 `3c63`) but sets it nowhere                                                                                                                                                                      |
| 100Ah | `PDERR_CREATEICFAILURE`  | no device context or information context         | Print (seg3 `172b`)                                                                                                                                                                                                                            |
| 100Bh | `PDERR_PRINTERNOTFOUND`  | the printer named is not installed               | Print (seg3 `0abf`, `293f`)                                                                                                                                                                                                                    |
| 100Ch | `PDERR_DEFAULTDIFFERENT` | the printer named is not the default             | Print (seg3 `0c38`, `3c87`)                                                                                                                                                                                                                    |
| 2001h | `CFERR_NOFONTS`          | no fonts to choose from                          | Font (seg4 `05a2`)                                                                                                                                                                                                                             |
| 2002h | `CFERR_MAXLESSTHANMIN`   | `nSizeMax` below `nSizeMin`                      | Font (seg4 `0418`)                                                                                                                                                                                                                             |
| 3001h | `FNERR_SUBCLASSFAILURE`  | a list or button's class procedure not found     | Open, Save As (seg2 `11e4`)                                                                                                                                                                                                                    |
| 3002h | `FNERR_INVALIDFILENAME`  | the file name given is not valid                 | Open, Save As (seg2 `12d7`)                                                                                                                                                                                                                    |
| 3003h | `FNERR_BUFFERTOOSMALL`   | the file name's buffer is too small              | Open, Save As (seg2 `3369`)                                                                                                                                                                                                                    |
| 4001h | `FRERR_BUFFERLENGTHZERO` | no buffer, a length of nought, or no owner       | Find, Replace (seg5 `0059`, `0206`)                                                                                                                                                                                                            |

[[measured]] [[probe:ofnerr]], [[probe:findrepl]] and [[probe:choosclr]] record the codes their functions set; [[fn:COMMDLG.CommDlgExtendedError]] says which, and the print and font codes are on their topics.

## Hooks and templates

Every dialog takes the same two ways for a program to change it, each asked for by a flag of its structure.

- **A hook** is a procedure of the program's, in the structure, called with the dialog's messages before COMMDLG's own code; an answer not nought is the procedure's answer. [[read out]] `COMMDLG` calls a hook with its own data segment in DS (`COMMDLG.DLL` seg2 `42f4`, seg2 `4331`), so a hook finds its program's data only through its thunk ([[topic:dynamic-link-libraries]]). WinBox calls one so, with the file's data segment or its own.
- [[read out]] **When the hook is first called** differs: the file boxes keep it in COMMDLG's data while the box is made, and call it for what USER sends before `WM_INITDIALOG` ([[fn:COMMDLG.FileOpenDlgProc]]); Find and Replace keep it too but call it only once the dialog has its property ([[fn:COMMDLG.FindTextDlgProc]]); Color calls it only with its property ([[fn:COMMDLG.ColorDlgProc]]). Font keeps it in COMMDLG's data while the dialog is made (`[17Ah]`) and clears it in `WM_INITDIALOG` ([[topic:choose-font]]). Each gives the hook `WM_INITDIALOG` with its structure as `lParam`, after it has set the dialog up.
- [[read out]] A hook flag with no hook is `CDERR_NOHOOK`; a hook given without its flag is written over with nought in the program's structure by Open, Find, Color and Print, but not by Font. After Print opens Print Setup, the setup hook is given the Print dialog's messages ([[topic:print-dialogs]]).
- **A template** is the program's dialog in place of COMMDLG's. [[read out]] With the `ENABLETEMPLATE` flag, `lpTemplateName` names a dialog of the module `hInstance`, found with `FindResource(RT_DIALOG)`; with `ENABLETEMPLATEHANDLE`, `hInstance` is itself the template's global handle. The dialog is still made on COMMDLG's instance with COMMDLG's procedure, so the template must keep the control ids COMMDLG drives; a control it leaves out is left alone ([[topic:find-and-replace]]).
- [[read out]] The errors differ by dialog: a name of nought is `CDERR_NOTEMPLATE` for Open and Color, an instance of nought `CDERR_NOHINSTANCE`, a name not found `CDERR_FINDRESFAILURE` (Print: `CDERR_LOADRESFAILURE`; Font checks neither name nor instance); Find's handle of nought fails to lock, `CDERR_LOCKRESFAILURE`, where Color's is `CDERR_NOTEMPLATE`.

## COMMDLG's resources

[[read out]] The resources of `COMMDLG.DLL`:

| Type    | Id                   | What                                                                                                                                                                                                       |
| ------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dialog  | 1536                 | Open and Save As, 264 × 134 ([[topic:file-dialogs]])                                                                                                                                                       |
| dialog  | 1537                 | Open and Save As for several files, its files' list `LBS_EXTENDEDSEL`                                                                                                                                      |
| dialog  | 1538                 | Print, 225 × 130 ([[topic:print-dialogs]])                                                                                                                                                                 |
| dialog  | 1539                 | Print Setup, 287 × 122                                                                                                                                                                                     |
| dialog  | 1540                 | Find, 236 × 62 ([[topic:find-and-replace]])                                                                                                                                                                |
| dialog  | 1541                 | Replace, 230 × 94                                                                                                                                                                                          |
| dialog  | `CHOOSECOLOR`        | Color, 298 × 184 ([[topic:choose-color]])                                                                                                                                                                  |
| dialog  | 1543                 | Font, 264 × 147 ([[topic:choose-font]])                                                                                                                                                                    |
| bitmap  | 576                  | the folders' and drives' pictures, 128 × 16, 16 colours ([[fn:COMMDLG.Ordinal 42]])                                                                                                                        |
| bitmap  | 38                   | the Font dialog's TrueType and printer pictures, 20 × 12 each, plain and selected, 16 colours ([[topic:choose-font]])                                                                                      |
| bitmap  | 584                  | 9 × 9, 16 colours; no code of COMMDLG's loads it                                                                                                                                                           |
| bitmap  | 30–37                | 8 × 10 (even ids) and 10 × 8 (odd), 16 colours; no code of COMMDLG's loads them                                                                                                                            |
| icon    | 528, 529             | Print Setup's portrait (528) and landscape (529), each three 32 × 32 icons of 2, 8 and 16 colours ([[topic:print-dialogs]])                                                                                |
| string  | 100h–103h            | "File Exists" and the overwrite prompt; "Exiting", "Do you really want to exit?"                                                                                                                           |
| string  | 180h–194h            | the file boxes' captions, label and messages ([[topic:file-dialogs]])                                                                                                                                      |
| string  | 300h–30Ah            | the templates' names by function: "FileOpen", "FileSave", "ExitChanges", "ChooseColor", "FindText", "ReplaceText", "FormatChar", "FontInfo", "PrintDlg", "PrintSetupDlg", "MultiFileOpen"                  |
| string  | 40Dh                 | "Close", Replace's Cancel once something is replaced                                                                                                                                                       |
| string  | 410h–41Fh            | the 16 colours' names, "Black" to "White", for the Font dialog's colour list                                                                                                                               |
| string  | 420h                 | "DlgInstData"                                                                                                                                                                                              |
| string  | 430h–433h            | the print qualities, "High" to "Draft"                                                                                                                                                                     |
| string  | 440h–448h, 45Ah–45Bh | Print's texts: "Printer:", "Default Printer (", the printer's line, the driver's entry names `ExtDeviceMode`, `DeviceMode` and `DeviceCapabilities`, "Print Setup", no default printer, a driver not found |
| string  | 44Ah–44Fh            | the Font dialog's size errors and its descriptions of a font's kind                                                                                                                                        |
| string  | 450h–459h            | Print's page range and copies errors; 458h is never shown                                                                                                                                                  |
| string  | 481h–4A9h, 580h      | the paper sizes' names, "Letter 8 1/2 x 11 in" to "German Legal Fanfold", and "User Defined Size"                                                                                                          |
| string  | 500h–507h            | "Fonts", no fonts installed, an invalid name or style, "Regular", "Bold", "Italic", "Bold Italic"                                                                                                          |
| version | 1                    | the version resource                                                                                                                                                                                       |

[[read out]] Every template is in 8-point "Helv", which the dialog manager makes bold MS Sans Serif ([[topic:standard-controls]]), and none is `WS_VISIBLE`.

## WinBox's code

The registration point is one entry per export, in each engine:

- TypeScript: `src/win16/commdlg/index.ts`, the export table. An export WinBox answers has its function in place of `CommDlg.stub`, with the bytes it pops, its arguments' types and its answer's type.
- Rust: `crates/winbox-win16/src/commdlg/mod.rs`, `implementation`, one arm per export by its name.
- `kept.rs` is written again from the TypeScript table (`npm run rust:modules`). The Rust test `commdlg::tests::ours_agree` checks that the two engines answer the same exports.

Helpers both engines keep for the dialogs: the far address of an export WinBox answers (`procAddress`, `proc_address`), the extended error (`setError`, `set_error`), `COMMDLG`'s instance (`instance`), a hook called as `COMMDLG` calls one (`callHook`, `call_hook`), the wait cursor (`waitCursor`, `wait_cursor`) and the registered messages (`message`).

**How a dialog calls USER, GDI and KERNEL.** Both engines make every call as a program makes it: its arguments pushed below the stack, its structures and strings laid out below them and read back after, and the function that answers a program's call run, through `api.ts` and `api.rs` (`guest-calls.ts` and `guest_calls.rs` give Find, Replace and Color the shape the file dialogs have). So the two engines make the same calls in the same order, and both show USER's quirks as COMMDLG's code would.

## Not yet done

- `LoadAlterBitmap`, `WEP` and the unnamed entries are stubs; nothing outside COMMDLG calls them.
- The memory device context `LibMain` makes and keeps (seg7 `01a1` to `0203`) is not made without the file.
- The dialogs keep their data in WinBox's memory, not under the property A000h as COMMDLG keeps it ([[topic:file-dialogs]], [[topic:find-and-replace]], [[topic:choose-color]], [[topic:choose-font]], [[topic:print-dialogs]]).
