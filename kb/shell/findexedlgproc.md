---
kind: function
module: SHELL
name: FindExeDlgProc
ordinal: 101
summary: The procedure of SHELL's box for finding a program, which ShellExecute shows where a registry association's program cannot be found.
versions:
  '3.1': exact
probes: [findexe]
source: crates/winbox-win16/src/shell/find_program.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:findexe]]: an association in `WIN.INI`'s [extensions] to a program that is not there answers 2 with no box. Through the registry, the box "Program Not Found" comes up instead, its texts filled with the program's name and the extension, the folder's control holding the root of the drive Windows is on. Cancel answers 15. A folder without the program and OK is told "Cannot find file '...'." with the path tried, captioned as the box, and the box stays. A folder with it and OK writes WIN.INI's [programs] line for the program's name with its path and starts it, with the document's path. Asked again, the line is used and no box shown.

## Inside Windows

- [[read out]] The procedure, `SHELL.DLL` seg8 `010e`-`056d`: `WM_INITDIALOG` registers `commdlg_help`, keeps the block in `DWL_USER`, and fills 205 with the program and the extension, 206 with the program, and 203 with the folder; `WM_COMMAND` -- TRUE for every one -- OK (`0458`) makes the path, a `\` added where the folder ends in neither `:` nor `\`, tries it with `OpenFile(OF_EXIST)`, and writes [programs] and ends with 1, or tells SHELL's string DFh with `MB_ICONHAND`; Cancel ends with 2; Locate (201) loads `commdlg.dll` and calls its `GetOpenFileName` (ordinal 1), filtered on the extension, and puts the folder chosen in 203; Help (204) and `commdlg_help` open `progman.hlp`; `WM_DESTROY` frees COMMDLG.
- [[read out]] The routine that shows it, SHELL's unnamed ordinal 119 (seg8 `0570`-`078f`): the program cut from the command at its first space, its name given `.exe` where it has no `.`; 2 where `OpenFile` finds it as written; WIN.INI's [programs] line for the name where the file it names is there; else the box, its folder the line's folder or the root of the Windows drive; OK's path with the rest of the command started again (-1 to `ShellExecute`), Cancel 15, anything else 2.
- [[read out]] `ShellExecute`'s body calls it once, where `WinExec` answered 2 for a command the registry gave (seg4 `0abf` sets the flag after `RegQueryValue`; `0fee`-`1020`).

## Callers

- No file imports it: SHELL's own routine hands it to `DialogBoxParam` (`kb/data/shell-callers.json`).

## Implementation

`crates/winbox-win16/src/shell/find_program.rs`. The box is made with `DialogBoxParam`'s machinery and this export as its procedure, through SHELL's and USER's own exports as COMMDLG's calls are made. **Not yet done**: Locate, which asks COMMDLG's `GetOpenFileName`; Help opens WinBox's `WinHelp`.
