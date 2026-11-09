---
kind: function
module: KEYBOARD
name: GetTableSeg
ordinal: 126
summary: A selector of the segment the keyboard layout's tables are in.
versions:
  '3.1': exact
probes: [kbdrv]
records: [tableseg]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: its first 88h bytes are the layout's tables -- each key's virtual key and characters, `kbdus.asm`, and the Ctrl tables.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg2 `0088`: the driver's code segment 2, kept at 12h of its data for [[fn:KEYBOARD.ToAscii]] to read from.

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`). A block of WinBox's own holding the same bytes, made as it is first asked for.
