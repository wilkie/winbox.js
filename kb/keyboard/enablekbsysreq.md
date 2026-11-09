---
kind: function
module: KEYBOARD
name: EnableKBSysReq
ordinal: 136
summary: The SysRq key's flags set and cleared.
versions:
  '3.1': exact
probes: [kbdrv]
records: [sysreq]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]]: nought answers 2, the flags as Windows left them; then 1 3, 4 3, 2 2, 8 nought, 5 3, F0h 3, 10 nought.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `096d`-`09a9`: 1 sets bit 0, 2 clears it, 4 sets bit 1, 8 clears it, in that order, and the flags are answered (data 130h). Nothing else in the driver sets them; who calls it with 4 as Windows starts was not found.

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`). The flags begin at 2, as recorded.
