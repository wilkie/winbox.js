---
kind: function
module: USER
name: OldExitWindows
ordinal: 2
summary: Windows left at once, nothing asked.
versions:
  '3.1': unrecorded
topics: [several-programs]
source: crates/winbox-win16/src/small_calls.rs
---

## Inside Windows

- [[read out]] `USER.EXE` seg3 `0059`-`005e`: `INT 21h` function 4Ch with nought -- the program ended as DOS ends one, no program asked or told. Not recorded: it ends the oracle's Windows.

## Implementation

`crates/winbox-win16/src/small_calls.rs`. WinBox ends as its [[fn:USER.ExitWindows]] ends once every program agrees.
