---
kind: function
module: KEYBOARD
name: Inquire
ordinal: 1
summary: What the keyboard is: six bytes, the double-byte ranges and the state's size.
versions:
  '3.1': exact
probes: [kbdrv]
records: [inquire]
topics: [keyboard-driver]
source: src/win16/keyboard/driver.ts
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: 6, and the bytes `ff fe ff fe 04 00` -- no double-byte character ranges, and four.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `09ac`: six bytes copied from its data at 131h; USER calls it as Windows starts (`USER.EXE` seg3 `0331`).

## Implementation

`src/win16/keyboard/driver.ts`; the Rust engine's `crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`keyboard/tables.ts`, `keyboard_tables.rs`).
