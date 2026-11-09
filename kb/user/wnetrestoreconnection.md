---
kind: function
module: USER
name: WNetRestoreConnection
ordinal: 523
summary: Network drives connected again as Windows starts: with no network driver, WN_NOT_SUPPORTED.
versions:
  '3.1': exact
probes: [wnetall]
records: [ok]
topics: [small-queries]
source: crates/winbox-win16/src/wnet.rs
---

## Observed behaviour

- [[measured]] [[probe:wnetall]]: 1, `WN_NOT_SUPPORTED`.

## Inside Windows

- [[read out]] `USER.EXE` seg22 `0478`: 1 where no network driver is loaded (`[362h]`); else the connections `WIN.INI` keeps made again, asking with a box where one fails.

## Implementation

`crates/winbox-win16/src/user_misc.rs`.
