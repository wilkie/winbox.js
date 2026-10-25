---
kind: function
module: USER
name: FillWindow
ordinal: 324
summary: What a device context draws in of a window filled, as PaintRect fills.
versions:
  '3.1': exact
probes: [usermisc]
records: [brush]
topics: [standard-controls]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: the child's area filled with its parent's answer to `WM_CTLCOLOR`, or with no parent given, its own.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `7766`: the window its own parent where none is given; the device context's clip box, within the window's client area for a class of `CS_PARENTDC`, nothing where it is empty (`78be`); then `PaintRect`.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
