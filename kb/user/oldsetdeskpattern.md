---
kind: function
module: USER
name: OldSetDeskPattern
ordinal: 279
summary: The desktop's pattern made again from WIN.INI's.
versions:
  '3.1': unrecorded
topics: [system-parameters]
source: crates/winbox-win16/src/small_calls.rs
---

## Inside Windows

- [[read out]] `USER.EXE` seg41 `0a51`: USER's own `SetDeskPattern` with -1 for the pattern (`0a61`-`0c03`), the function `SPI_SETDESKPATTERN` calls too (seg41 `141f`). The pattern is read from `WIN.INI`'s `[Desktop]` and the `[Patterns]` it names, the brush made again, `WM_SYSCOLORCHANGE` sent round (seg1 `a786` with 15h) and the screen drawn again, frames and all (seg1 `3ed7` with 485h). Its answer is that function's. Not recorded.

## Implementation

`crates/winbox-win16/src/small_calls.rs`. [[fn:USER.SystemParametersInfo]] with `SPI_SETDESKPATTERN` and -1.
