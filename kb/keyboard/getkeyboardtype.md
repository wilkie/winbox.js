---
kind: function
module: KEYBOARD
name: GetKeyboardType
ordinal: 130
summary: The keyboard's type, its subtype or how many function keys it has.
versions:
  '3.1': exact
probes: [kbdrv]
records: [type]
topics: [keyboard-driver]
source: src/win16/keyboard/driver.ts
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: 0 answers 4, 1 nought, 2 twelve, 3 nought; 100h answers 4.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg7 `0000`-`0035`: by the argument's low byte, the type (data 0Ch), the subtype (0Fh) or the function keys (137h); nought else.

## Implementation

`src/win16/keyboard/driver.ts`; the Rust engine's `crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`keyboard/tables.ts`, `keyboard_tables.rs`).
