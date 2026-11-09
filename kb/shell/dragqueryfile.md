---
kind: function
module: SHELL
name: DragQueryFile
ordinal: 11
summary: A dropped file's name, or how many files were dropped.
versions:
  '3.1': exact
probes: [dragq]
records: [count, file]
topics: [programs-and-their-files]
source: crates/winbox-win16/src/shell/drag.rs
---

## Observed behaviour

- [[measured]] [[probe:dragq]] reads a block made as File Manager makes one: -1 answers the count; a file's index its name's length, and the name copied where a buffer with room is given -- as much as fits, with a nought. The answer is the whole name's length even where it did not fit: `C:\DIR\TWO.DOC` in 5 bytes is `C:\D`, and 14. A size of nought or no buffer writes nothing. Past the last name, nought.

## Inside Windows

- [[read out]] `SHELL.DLL` seg6 `0094`-`013e`: the block locked; the names from the offset in its first word, each passed over to its nought; `lstrlen` of the name found; the copy (ordinal 112) of the size less one, or the length, whichever is less; the answer the length (`0129`).

## Implementation

`crates/winbox-win16/src/shell/drag.rs`. Nothing in WinBox drops files yet; a block made as File Manager makes one reads as SHELL reads it.
