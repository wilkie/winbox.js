---
kind: function
module: COMMDLG
name: Ordinal 38
ordinal: 38
summary: DOS's Find First File (function 4Eh) for the file dialogs: a path and attributes in, nought or DOS's error out.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2d45` (`retf 6`): the arguments are a far pointer to the path and a word of attributes; it calls `DOS3Call` with AX 4E00h, CX the attributes and DS:DX the path, and answers nought, or AX as DOS left it on a carry, its error.
- [[read out]] The result goes to the disk transfer area [[fn:COMMDLG.Ordinal 39]] set. The file dialogs call it as they fill the files' and folders' lists (seg2 `054f`) and for the drives (seg2 `5393`).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2d45`, one of COMMDLG's small DOS helpers at the end of seg1 (`2ba4` to `2e84`), each a frame around one or two `DOS3Call`s.

## Implementation

Not WinBox's own: ordinal 38 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 6 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's. WinBox's file dialogs make the same DOS call themselves, through KERNEL's `DOS3Call` as a program would (`file-lists.ts`, `file_lists.rs`).
