---
kind: function
module: SHELL
name: DragQueryPoint
ordinal: 13
summary: Where dropped files were dropped, and whether in the client area.
versions:
  '3.1': exact
probes: [dragq]
records: [point]
topics: [programs-and-their-files]
source: crates/winbox-win16/src/shell/drag.rs
---

## Observed behaviour

- [[measured]] [[probe:dragq]]: the point in the block's words 2 and 4; 1 where its word 6 is nought, nought for 1 or 5.

## Inside Windows

- [[read out]] `SHELL.DLL` seg6 `0000`-`004f`: the block locked, the point copied, the answer whether the flag is nought.

## Implementation

`src/win16/shell/drag.ts`; the Rust engine's `crates/winbox-win16/src/shell/drag.rs`. Nothing in WinBox drops files yet; a block made as File Manager makes one reads as SHELL reads it.
