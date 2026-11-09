---
kind: function
module: SHELL
name: WEP
ordinal: 8
summary: SHELL's exit procedure: the registration database written out, and 1.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/shell.rs
---

## Inside Windows

- [[read out]] `SHELL.DLL` seg7 `0000`, `01ca`-`0230`: where the registration database's file is open and changed, it is written out; then 1. Not recorded.

## Implementation

1. WinBox writes its registration database as it changes ([[topic:registration-database]]). `crates/winbox-win16/src/shell.rs`'s table; the Rust engine's `shell.rs`.
