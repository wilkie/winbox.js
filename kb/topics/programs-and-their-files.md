---
kind: topic
name: Programs and their files
summary: How SHELL finds the program that opens a file, pulls a program's icons out of its file, and fills a string's %NAME%s from the environment — read out of SHELL.DLL and recorded.
probes: [shell2]
---

Program Manager and File Manager ask SHELL three things about files:
- which program opens a file;
- what icons a program has;
- what a command line becomes once its variables are filled in.

[[probe:shell2]] asks each of them for files that are programs, files with associations, files with none, and files that are not there. All 37 records agree with winbox.js.

## The program that opens a file

[[fn:SHELL.FindExecutable]] shares its body with `ShellExecute`, and launches nothing (`SHELL.DLL` seg4 `082e`). [[read out]] In order:

1. The file's name is upper-cased, and the directory given becomes the current one for the search.
2. The file is found as `OpenFile` finds it, which answers the DOS error: [[measured]] 2 for no file, 3 for a directory that is not there. A bare name is looked for in the current directory, then Windows', then its system directory. So `SAMPLE.TXT` with no directory is not found in `C:\ORACLE`.
3. A name with no extension is tried with each of the program extensions in turn.
4. A file whose extension is in `WIN.INI`'s `[windows]` `Programs=` (by default `exe com bat pif`) is its own program. [[measured]] The answer is its full path, `C:\WINDOWS\NOTEPAD.EXE`.
5. The registration database is asked first, for `.EXT`'s class and then its `shell\open\command`, with `%1` replaced by the file's path.
6. Then `WIN.INI`'s `[extensions]`, with each `^` replaced by the file's path less its extension.
7. [[measured]] Nothing found answers **31**.

The result is cut at its first space. [[measured]] So `WIN.INI` and text files answer `notepad.exe`, and a bitmap `pbrush.exe`, spelled as the association spells them. On success the call answers **1000**. On any error the result is left empty.

## Icons out of a program's file

[[fn:SHELL.ExtractIcon]] reads the file itself (seg10 `026e`).

- [[measured]] Asked for index -1, it answers how many icons the program has: 46 for Program Manager, 106 for `MORICONS.DLL`, 1 for Notepad, nought for `GDI.EXE`.
- [[measured]] Asked for an index, it answers an icon, or nought past the last.
- [[read out]] The icons are the program's icon groups, counted by their places in the resource table rather than by their numbers. A module made for Windows before 3.0 has its icons counted instead of groups. Each group's image is the one for the display, chosen as USER's `GetIconID` chooses: the display's size, then its colours.
- [[measured]] A file that is not a Windows program, `WIN.INI` for one, answers 1, or nought for -1. A file that is not there answers nought.

## A string's variables

[[fn:SHELL.DoEnvironmentSubst]] fills a string's `%NAME%`s from the task's environment, in place (seg5 `00ae`).

- [[measured]] Names match whatever their case, so `%WINDIR%` finds `windir`. A name that is not there is left as it is. `%%` is one `%`, and a `%` with nothing after it stays.
- [[measured]] It answers 1 in the high word and the new length in the low, when the result and its nought fit the size given. Otherwise it answers nought and the string's own length, and the string is left as it was. `%windir%` fits in 11 bytes, and not in 10.
- The recording substitutes `windir`, which winbox.js's tasks have too. Under DOSBox the recording's Windows also had `COMSPEC`, `PATH` and `BLASTER`, which winbox.js's host does not lend ([[topic:task-startup]]).

## In winbox.js

`src/win16/shell/programs.ts` has these calls. `FindEnvironmentString`, the lookup `DoEnvironmentSubst` uses, is exported too. Not followed:
- `ShellExecute`, which starts the program it finds;
- icons from `.ICO` files, and from Win32 programs through `W32SYS.DLL`.
