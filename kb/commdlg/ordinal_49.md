---
kind: function
module: COMMDLG
name: Ordinal 49
ordinal: 49
summary: A drive's volume label, by an extended FCB search, in brackets or not.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg1 `2d91` (`retf 0Ch`): the drive (0 for A), a far pointer to where the label goes, a word saying whether to bracket it, and a far pointer to a disk transfer area to use.
- [[read out]] The disk transfer area is kept and the one given set (DOS 2Fh, 1Ah). COMMDLG's extended FCB at `[0298h]` -- FFh, attribute 8 (a volume label), the name `???????????` -- gets the drive plus one, and DOS function 11h searches with it.
- [[read out]] Found, the label is the 11 bytes at offset 8 of the area, with spaces, noughts and tabs cut off its end, between `[` and `]` when asked; not found, nothing. Either way a nought ends what was written, and the area is put back.
- [[read out]] Caller: the drives' list (seg2 `494e`), where a fixed drive shows its label ([[topic:file-dialogs]]).

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg1 `2d91`.

## Implementation

Not WinBox's own: ordinal 49 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 12 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's.
