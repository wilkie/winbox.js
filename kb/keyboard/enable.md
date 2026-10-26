---
kind: function
module: KEYBOARD
name: Enable
ordinal: 2
summary: The keyboard driver enabled with an event procedure and a key-state table, set from the BIOS's shift flags.
versions:
  '3.1': exact
probes: [kbenable]
records: [kb]
source: src/win16/keyboard/driver.ts
topics: [keyboard-driver]
---

## Observed behaviour

- [[read out]] `KEYBOARD.DRV` seg10 `09d0`-`0a65`: the event procedure kept in the driver's data at FAh; the key-state table given set from the BIOS's shift flags at 40:17h -- 80h or nought for Shift, Ctrl and Alt (10h, 11h, 12h), 1 or nought for Scroll, Num and Caps Lock (91h, 90h, 14h; `0a68`-`0aab`); then, where it is not enabled, the keyboard's interrupt taken (INT 9, with INT 16h's kept), the type read once (`NewTable`), the BIOS's keyboard flags at 40:96h kept and their bit 4 cleared for an enhanced keyboard, enabled (12Eh FFh).
- [[measured]] [[probe:kbenable]]: as Windows has started the procedure is USER's `keybd_event` and the driver enabled; the six bytes are the BIOS's flags', another left; enabled again after `Disable`.

## Nuances

- WinBox's keyboard comes to USER by no interrupt: the procedure is kept and not called.

## Implementation

`src/win16/keyboard/driver.ts`, and the Rust engine's `keyboard.rs`.
