---
kind: function
module: KERNEL
name: GetExpWinVer
ordinal: 167
summary: The Windows version a module was made for; undocumented.
versions:
  '3.1': exact
probes: [lbmark]
source: src/win16/kernel/GetExpWinVer.ts
topics: [list-boxes, combo-boxes]
---

## Observed behaviour

[[measured]] [[probe:lbmark]] asks it of four instances: its own, a probe made for 3.00, answers 300h; `SHELL`'s 300h; `USER`'s 30Ah; and `KERNEL`'s 30Ah, though `KRNL386.EXE`'s header says 3.00.

## Nuances

- [[read out]] The low word is the module's word 3Eh, the expected Windows version, of the module `GetExePtr` finds for the handle; the high word is its flag 2000h; a handle of no module answers nought in AX and leaves DX as it was (`KRNL386.EXE` seg1 `4f02`-`4f27`).
- [[read out]] A module's word 3Eh is its file's header's, as `LoadModule` reads it (`KRNL286.EXE` seg2 `0ed3`-`0f33`), but KERNEL's own: as it starts, KERNEL sets in its module the Windows version, 30Ah, in place of the file's (`KRNL386.EXE` seg1 `c285`-`c288`, `KRNL286.EXE` seg1 `b403`-`b406`).
- [[read out]] `CreateWindow` asks it of the instance it is given, and marks a window of a module made for 3.10 or later (`USER.EXE` seg8 `0425`-`0432`); a list box's double click and a combo box's `CBN_SELENDOK` hang on the mark ([[topic:list-boxes]], [[topic:combo-boxes]]).

## Implementation

Both engines answer from one helper, `expectedWindowsVersion` (`src/win16/module.ts`) and `System::expected_windows_version`, which marks windows too: a program's or library's file's header; KERNEL's 30Ah; WinBox's own `COMMDLG`'s 300h with no file; another kept module's file's header, the installation's or the asset bundle's. The high word is not answered. A kept module with no file anywhere answers nought here, where USER would mark its windows 3.10.
