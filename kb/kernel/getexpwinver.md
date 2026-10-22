---
kind: function
module: KERNEL
name: GetExpWinVer
ordinal: 167
summary: The Windows version a module was made for; undocumented.
versions:
  '3.1': exact
records: [expwinver]
probes: [lbmark, modnum]
source: src/win16/kernel/GetExpWinVer.ts
topics: [list-boxes, combo-boxes]
---

## Observed behaviour

[[measured]] [[probe:lbmark]] asks it of four instances: its own, a probe made for 3.00, answers 300h; `SHELL`'s 300h; `USER`'s 30Ah; and `KERNEL`'s 30Ah, though `KRNL386.EXE`'s header says 3.00.

[[measured]] [[probe:modnum]] reads both words for those and `MAIN.CPL`'s instance (30Ah): the high word is nought for each.

## Nuances

- [[read out]] The low word is the module's word 3Eh, the expected Windows version, of the module `GetExePtr` finds for the handle; the high word is its flag 2000h; a handle of no module answers nought in AX and leaves DX as it was (`KRNL386.EXE` seg1 `4f02`-`4f27`).
- [[read out]] **Flag 2000h** is set by `LoadModule` on a module whose file's header has 02h in its byte 37h (`KRNL386.EXE` seg2 `0ed9`-`0edc`, `1271`-`1279`). [[documented]] That byte is the header's other flags, and 02h marks a Windows 2 program that runs in protected mode. [[read out]] A file whose own flags, word 0Ch, have 2000h is refused as not a program, error 11 (seg2 `0ebd`-`0ec2`). [[measured]] No module of the installation, no probe and no program of the corpus has 02h there, so the high word is nought for all of them.
- [[read out]] A module's word 3Eh is its file's header's, as `LoadModule` reads it (`KRNL286.EXE` seg2 `0ed3`-`0f33`), but KERNEL's own: as it starts, KERNEL sets in its module the Windows version, 30Ah, in place of the file's (`KRNL386.EXE` seg1 `c285`-`c288`, `KRNL286.EXE` seg1 `b403`-`b406`).
- [[read out]] `CreateWindow` asks it of the instance it is given, and marks a window of a module made for 3.10 or later (`USER.EXE` seg8 `0425`-`0432`); a list box's double click and a combo box's `CBN_SELENDOK` hang on the mark ([[topic:list-boxes]], [[topic:combo-boxes]]).

## Implementation

Both engines answer from one helper, `expectedWindowsVersion` (`src/win16/module.ts`) and `System::expected_windows_version`, which marks windows too: a program's or library's file's header; KERNEL's 30Ah; another kept module's file's header, the installation's or the asset bundle's; and where the base has no file of it, the version its file has on the installation, which WinBox's stand-in carries as `COMMDLG`'s does (`KEPT_VERSIONS`, `kept_version`): 300h for `COMMDLG`, `DDEML`, `LZEXPAND`, `TOOLHELP`, `VER`, `WIN87EM` and `SHELL`, 30Ah for the rest, each its file's word 3Eh on the installation. The high word is the file's byte 37h's 02h as 2000h (`moduleFlag2000`, `System::module_flag_2000`); nought for a kept module with no file. A handle of no module leaves DX as it was.
