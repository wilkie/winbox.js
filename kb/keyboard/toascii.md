---
kind: function
module: KEYBOARD
name: ToAscii
ordinal: 4
summary: The character a key types, from its virtual key, scan code and the key-state table; Alt and the keypad's digits type a character by its number.
versions:
  '3.1': exact
probes: [kbdrv]
records: [toascii, altnum]
topics: [keyboard-driver, keyboard-input]
source: src/win16/keyboard/driver.ts
---

## Observed behaviour

- [[measured]] [[probe:kbdrv]] calls it for every virtual key with its scan code under eight shift states, and types numbers on the keypad with Alt held. Both engines agree with every record.
- A letter is small, capital with Shift, the other way about with Caps Lock; with Ctrl, with or without Shift, its low five bits.
- The keypad's digits, 60h to 69h, type 0 to 9 without Ctrl or Alt.
- The rest come from the layout: with Ctrl, Ctrl+2 and Ctrl+6, whose characters have bit 7 set, type nothing alone and nought and 1Eh with Shift too.
- Alt alone types as no shift at all: Alt+A is `a`.
- Alt with the keypad's digits: each digit's key down makes the byte at `lpChar` ten times itself plus the digit, in a byte, and answers nought; the same key down again is not counted; Alt's release answers 1. 65 is `A`; 130, an OEM `é`, is ANSI E9h; 0233, begun with nought, is E9h as typed; 300 is 2Ch, the byte wrapped.
- With flag 1 the digits type themselves; with flag 2 they type nothing.
- A release answers nought and writes nothing.

## Inside Windows

- [[read out]] `KEYBOARD.DRV` seg10 `0430`-`06c5`. The shift state is Shift 1, Ctrl 2, Alt 4 from the table's 10h, 11h and 12h, and each state's table is the driver's at 112h. The Alt numbers are kept at 128h (begun with nought) and 129h (the last digit's key). Where nothing is typed, the BIOS's shift flags at 40:17h are set from the table and nought is written as a word (`06c8`).

## Implementation

`src/win16/keyboard/driver.ts`; the Rust engine's `crates/winbox-win16/src/keyboard.rs`. The driver's tables are WinBox's own, made by `scripts/oracle/keyboard-tables.mjs` (`keyboard/tables.ts`, `keyboard_tables.rs`). Not followed: the BIOS's shift flags, which WinBox has no BIOS for; dead keys and Caps Lock tables, which the US layout has none of.
