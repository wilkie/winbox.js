---
kind: function
module: SHELL
name: ExtractAssociatedIcon
ordinal: 36
summary: The icon for an item Program Manager shows — the file's own, else the icon of the program associated with it, else one of the caller's own — with the path and index it used written back.
versions:
  '3.1': exact
probes: [associco]
source: src/win16/shell/programs.ts
---

## Observed behaviour

[[probe:associco]] asks for the icons of programs, documents, files with no association and files that are not there. It records whether an icon came back, the path and index written back, and what [[fn:USER.DumpIcon]] says of the icon. The probe's own module holds two icons, numbered 2 and 6. winbox.js runs it whole, and all 18 of its records agree.

- [[measured]] A program with an icon at the index gives that icon. The path and index are left as they were: `NOTEPAD.EXE` 0, `PROGMAN.EXE` 9, `MORICONS.DLL` 3, and USER's own `USER.EXE` 0. A name with no path is found as `OpenFile` finds it: `NOTEPAD.EXE` gives Notepad's icon.
- [[measured]] A document gives the icon of the program `[Extensions]` names for it. The path becomes that program as the association spells it, `notepad.exe`, and the index is kept: `NOTES.TXT` 0 gives Notepad's icon.
- [[measured]] With no icon at the index, the file not there, or the associated program having none there, the answer is the caller's icon 2. The path becomes the caller's module's and the index 6. That is what Notepad at index 1, `NOTES.TXT` at index 2, `C:\NOPE.EXE` and `C:\NOPE.TXT` all give.
- [[measured]] A file that is not a Windows program and has no association, but does have an extension (`PLAIN.XYZ`), gives the caller's icon 6. The path becomes the caller's and the index 1. `WIN.COM` gives the same: its program is itself, which still has no icon.
- [[measured]] Such a file with no extension at all (`NOEXT`) gives the caller's icon 2, index 6.

## Nuances

- [[read out]] The answer is an icon handle, from `ExtractIcon` or from [[fn:USER.LoadIcon]] on the instance passed. Program Manager locks it with `LockResource` and reads it with [[fn:USER.DumpIcon]] (`PROGMAN.EXE` seg4 `11e2`-`1227`).
- [[read out]] The index that is written back is not the number of the icon loaded. Icon 2 goes with index 6, and icon 6 with index 1. Those are Program Manager's numbers: its own icon resources 2 and 6, at those places in its resource table. An item saved with Program Manager's path and that index finds the same icon again.
- [[read out]] The path buffer is written with up to 128 bytes of the module's path (`GetModuleFileName`), and the program's name with `.EXE` added when it has no extension.
- [[measured]] Program Manager's items show this: an item whose program is not found gets the icon path empty and index 6 in its group's text ([[probe:progdde]]).

## Inside Windows

[[read out]] `SHELL.DLL` seg10 `08dc`:

1. `ExtractIcon` of the path at the index (`08ea`). Any icon is the answer.
2. If it answers 1 (the file is not a Windows program), `FindExecutable` of the path with no directory (`0944`). If no program is found, the result depends on the extension (seg10 `0884`, after the last `.` that follows the last `\`). With an extension it is the caller's icon 6 and index 1 (`09af`). Without one it is the caller's icon 2 and index 6 (`0904`).
3. If a program is found, it is copied over the path, with `.EXE` added where it has no extension (`0960`-`0988`). `ExtractIcon` runs again on it. A 1 gives the caller's icon 6, and nought gives the caller's icon 2.
4. If it answers nought (no file, or no icon at that index), it is the caller's icon 2 and index 6 (`0904`-`0924`).

## Implementation

`ExtractAssociatedIcon` in `src/win16/shell/programs.ts` and `extract_associated_icon` in `crates/winbox-win16/src/shell/programs.rs` follow those steps. They use the engines' own `ExtractIcon`, `FindExecutable`, `GetModuleFileName` and `LoadIcon`.
