---
kind: function
module: KEYBOARD
name: SetSpeed
ordinal: 7
summary: The keyboard's typematic rate set: the rate given, or nought for -1.
versions:
  '3.1': exact
probes: [kbdrv]
records: [speed]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: -1 answers nought; nought answers nought, the rate given.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg6 `0020`-`0073`: only on an AT or a PS/2 (model byte FCh or F8h), else -1. -1 sets nothing. Any other rate is sent to the keyboard's controller (F3h, then the rate's delay and the table's rate for its low five bits), and answered where the controller took both, else -1. USER calls it as Windows starts with `WIN.INI`'s `KeyboardSpeed` (`USER.EXE` seg3 `249e`).

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`). DOSBox's controller takes the rate, so it is answered.
