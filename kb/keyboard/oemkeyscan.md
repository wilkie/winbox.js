---
kind: function
module: KEYBOARD
name: OemKeyScan
ordinal: 128
summary: The scan code and shift state that type an OEM character.
versions:
  '3.1': exact
probes: [kbdrv]
records: [oemscan]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]] asks for every character; both engines agree with all 256.
- A capital is its letter with Shift (2 in the high word), a small letter its capital's; 01h to 1Ah are Ctrl (4) and a letter; space, Enter, Tab and Backspace their keys; the rest as [[fn:KEYBOARD.VkKeyScan]] finds them, but not with Alt; a character from 80h up as the ANSI character it is, where that is 80h or more and comes back the same. -1 for the rest.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg4 `0000`-`00c0`. The scan code is the first of the driver's table of 3Ah scan codes' virtual keys (data 48h) to hold the key.

## Implementation

`src/win16/keyboard/driver.ts`; the Rust engine's `crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`keyboard/tables.ts`, `keyboard_tables.rs`).
