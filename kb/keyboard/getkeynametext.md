---
kind: function
module: KEYBOARD
name: GetKeyNameText
ordinal: 133
summary: A key's name, from a key message's lParam.
versions:
  '3.1': exact
probes: [kbdrv]
records: [keyname]
topics: [keyboard-driver]
source: crates/winbox-win16/src/keyboard.rs
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]] names every scan code, plain and extended, and WinBox agrees with every record.
- A key that types a printable character is that character: `A`, `1`, `\`. The others are named from the driver's lists: `Esc`, `Backspace`, `Num 7`, `Right Shift`; extended `Num Enter`, `Right Ctrl`, `Home`, `Delete`. Scan code 54h is `<00>`, 60h to 67h `F11` to `F18`.
- With bit 25, "don't care", the right Shift, Ctrl and Alt are named as the left.
- At most the size given is written, the null among it; the answer is how many characters were copied, but where the name did not fit, the size itself: Backspace in 9 bytes is `Backspac` and 9. A size of 1 writes the null alone and answers 1; nought writes nothing and answers nought.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg9 `0305`-`0418`. Scan codes up to 35h (not extended) and 56h are first asked of [[fn:KEYBOARD.MapVirtualKey]] for their character; above 20h it is the name. A layout library may name the keys instead (`GetKeyString`, `03b5`).

## Implementation

`crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`crates/winbox-win16/src/keyboard_tables.rs`).
