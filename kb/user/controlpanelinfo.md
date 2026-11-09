---
kind: function
module: USER
name: ControlPanelInfo
ordinal: 273
summary: Windows 3.0's SystemParametersInfo: the same, without its checks and without writing WIN.INI.
versions:
  '3.1': exact
probes: [usermisc]
records: [cpinfo]
topics: [system-parameters]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: for `SPI_GETBEEP`, `SPI_GETKEYBOARDSPEED` and `SPI_GETSCREENSAVETIMEOUT`, 1 and what [[fn:USER.SystemParametersInfo]] reads.

## Inside Windows

- [[read out]] `USER.EXE` seg41 `1716`: `SystemParametersInfo`'s own body (`0ed6`) with nought for its last argument, so `WIN.INI` is never written; none of the checks `SystemParametersInfo` makes of its arguments first (`1895`).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
