---
kind: function
module: KEYBOARD
name: GetBIOSKeyProc
ordinal: 137
summary: The BIOS's keyboard interrupt handler the driver found as it was enabled.
versions:
  '3.1': unrecorded
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `001e`: the INT 9 vector the driver kept as USER enabled it (`09f9`-`0a02`), before setting its own. Under the oracle's Windows that is DOSX's handler; not recorded, as WinBox has no BIOS.

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`). The INT 9 vector DOS answers for here as the driver is first called: nought.
