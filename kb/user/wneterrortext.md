---
kind: function
module: USER
name: WNetErrorText
ordinal: 499
summary: A network error's text, from USER's own strings.
versions:
  '3.1': exact
probes: [wnetall]
records: [text]
topics: [small-queries]
source: crates/winbox-win16/src/wnet.rs
---

## Observed behaviour

- [[measured]] [[probe:wnetall]]: code 1 is `Network function not supported.`, 2 `Network error.`, 6 `Incorrect password.`, 7 `Access denied.`, 11 `Out of memory.`; nought is the format itself, `Unexpected network error: 0x%4.4X`; a code with no string of its own is that format filled: 3 is `Unexpected network error: 0x0003`. The answer is the text's length. Asked for 8 bytes, `Network`.

## Inside Windows

- [[read out]] `USER.EXE` seg22 `005c`-`00e1`: for `WN_NET_ERROR` (2), the driver's own text where it gives one (`WNetGetError`, `WNetGetErrorText`); else USER's string 113h plus the code; where there is none, string 113h formatted with the code by `wsprintf`, into the buffer however small.

## Implementation

`crates/winbox-win16/src/user_misc.rs`.
