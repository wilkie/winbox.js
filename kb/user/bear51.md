---
kind: function
module: USER
name: Bear51
ordinal: 51
summary: Whether a byte leads a double-byte character: never, with the US keyboard driver.
versions:
  '3.1': exact
probes: [userint]
records: [bear]
topics: [keyboard-driver]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:userint]]: nought for every byte.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `1a6c`-`1a96`: the byte, and 1 above it, where it is in one of the two ranges of lead bytes the keyboard driver's [[fn:KEYBOARD.Inquire]] gave as USER started (`[98Eh]`, seg3 `032c`); else nought. The US driver's ranges are FFh to FEh, none.

## Implementation

`crates/winbox-win16/src/small_calls.rs`.
