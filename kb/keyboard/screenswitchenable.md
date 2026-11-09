---
kind: function
module: KEYBOARD
name: ScreenSwitchEnable
ordinal: 100
summary: Whether the display driver may switch the screen away: a flag kept.
versions:
  '3.1': exact
probes: [kbdrv]
records: [switch]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: 100h answers 101h, nought nought, 1 1.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `0952`-`096a`: the word's two bytes ORed together are kept at 104h, and the word answered with its low byte so. The display driver calls it with -1 (`VGA.DRV` seg1 `3178`).

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`).
