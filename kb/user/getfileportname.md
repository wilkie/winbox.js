---
kind: function
module: USER
name: GetFilePortName
ordinal: 343
summary: USER's Print To File box: asks for the name of a file for a printer's output, makes the file, and answers 1, -3 for Cancel, or -1 with a box already up.
versions:
  '3.1': exact
probes: [filport]
source: crates/winbox-win16/src/print_to_file.rs
topics: [user-internals, printing]
---

## Observed behaviour

- [[measured]] [[probe:filport]]: the box is captioned "Print To File", owned by the active window, with "&Output File Name:" (101), the name's edit control (10), OK -- disabled until there is a name -- and Cancel; the focus in the edit control. Called again while it is up, -1. Cancel answers -3 and makes nothing. A new name and OK make the file, empty, fill the `OFSTRUCT` with its path, and answer 1. A file that is there is asked about first, "Overwrite existing output file?" with Yes and No, captioned "FILE:": No leaves the box up, Yes makes it again. A name that cannot be made -- a drive that is not there -- is told, "Cannot open output file for writing. Check to ensure path and filename are correct.", OK alone, and the box stays.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `9c7c`-`9cc7`: -1 while the far pointer kept at 4E0h is not nought; else that kept, `DialogBoxParam` of USER's instance's dialog 10 owned by the window at 108h -- the active window -- with the procedure `9d0f`, the pointer cleared, and the dialog's result answered.
- [[read out]] The procedure (`9d0f`-`9e3a`): `WM_INITDIALOG` makes the box modal to its task (seg42 `0000`: the task's other enabled windows at the top disabled, kept as a property, and enabled again at the end, seg42 `0073`), limits the name to 63 (`EM_LIMITTEXT`) and disables OK; `EN_CHANGE` of the name enables OK while its length is not nought; OK reads the name (64 bytes) and tries it with `OpenFile(OF_WRITE | OF_SHARE_EXCLUSIVE)` -- opened, it is closed and USER's string 3Eh asked, `MB_YESNO | MB_ICONINFORMATION`, under USER's string 3Ch, and anything but Yes leaves the box up -- then makes it with `OF_CREATE | OF_WRITE`, telling string 3Dh with `MB_ICONEXCLAMATION` where that fails, and ends the box with 1; Cancel ends it with -3, the spooler's `SP_USERABORT`. TRUE for these, nought for the rest. The message box's helper is `9cca`: `LoadString` twice and `MessageBox` owned by the box.
- [[read out]] Dialog 10: 200 by 52 dialog units at 97, 60, "MS Sans Serif" 8.

## Callers

- [[read out]] No file imports it: a printer's driver finds it with `GetProcAddress` for the port `FILE:`. No corpus program calls it.

## Implementation

`crates/winbox-win16/src/print_to_file.rs`. The dialog is laid out from its controls, named constants; `test/win16/print_to_file_test.ts` compares it with `USER.EXE`'s dialog 10 where that is on disk. The procedure makes its calls through USER's and KERNEL's own exports, as COMMDLG's do (`commdlg/api.ts`).
