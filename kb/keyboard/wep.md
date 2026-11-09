---
kind: function
module: KEYBOARD
name: WEP
ordinal: 8
summary: The keyboard driver's exit procedure, which answers nothing.
versions:
  '3.1': unrecorded
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `0afc`: `RETF 2`, AX as it was.

## Implementation

`src/win16/keyboard/driver.ts`; the Rust engine's `crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`keyboard/tables.ts`, `keyboard_tables.rs`).
