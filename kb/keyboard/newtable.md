---
kind: function
module: KEYBOARD
name: NewTable
ordinal: 127
summary: The keyboard's type and tables read again from SYSTEM.INI.
versions:
  '3.1': exact
probes: [kbdrv]
records: [type]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: after it, [[fn:KEYBOARD.GetKeyboardType]] answers as before: 4, nought, 12.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg3 `00cd`-`0262`. A type already known, 1 to 6, is taken for 4. With none, as Windows starts, the BIOS's: 1, 3 on an AT, 4 with an enhanced keyboard (40:96h bit 4); then `SYSTEM.INI`'s `[keyboard]` `type=`, unless past 4. The function keys are the type's (driver's data E4h). Then `keyboard.dll=` and `oemansi.bin=`, a layout library and new OEM tables.

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`). A layout library and `oemansi.bin` are not followed. Its subtype, which nothing sets, stays nought.
