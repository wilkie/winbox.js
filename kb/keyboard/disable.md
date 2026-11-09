---
kind: function
module: KEYBOARD
name: Disable
ordinal: 3
summary: The keyboard driver disabled, where it was enabled: its interrupt given back, the BIOS's flags put back.
versions:
  '3.1': exact
probes: [kbenable]
records: [kb]
source: crates/winbox-win16/src/keyboard.rs
topics: [keyboard-driver]
---

## Observed behaviour

- [[read out]] `KEYBOARD.DRV` seg10 `0aac`-`0afb`: where enabled, the BIOS's keyboard flags at 40:96h put back for an enhanced keyboard, INT 9 given back, bits 8 and 9 of the shift flags at 40:17h cleared, and not enabled (12Eh nought). It takes no arguments.
- [[measured]] [[probe:kbenable]]: not enabled after; the flags' bits 8 and 9 nought.

## Implementation

`src/win16/keyboard/driver.ts`, and the Rust engine's `keyboard.rs`.
