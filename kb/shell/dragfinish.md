---
kind: function
module: SHELL
name: DragFinish
ordinal: 12
summary: The block of dropped files let go.
versions:
  '3.1': exact
probes: [dragq]
records: [finish]
topics: [programs-and-their-files]
source: crates/winbox-win16/src/shell/drag.rs
---

## Observed behaviour

- [[measured]] [[probe:dragq]]: the block's size is nought after.

## Inside Windows

- [[read out]] `SHELL.DLL` seg6 `0142`: `GlobalFree` of the handle, its answer left in AX.

## Implementation

`src/win16/shell/drag.ts`; the Rust engine's `crates/winbox-win16/src/shell/drag.rs`. Nothing in WinBox drops files yet; a block made as File Manager makes one reads as SHELL reads it.
