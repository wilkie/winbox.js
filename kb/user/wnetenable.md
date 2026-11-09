---
kind: function
module: USER
name: WNetEnable
ordinal: 521
summary: The network driver enabled: with no network driver, WN_NOT_SUPPORTED.
versions:
  '3.1': exact
probes: [wnetall]
records: [ok]
topics: [small-queries]
source: crates/winbox-win16/src/wnet.rs
---

## Observed behaviour

- [[measured]] [[probe:wnetall]]: 1, `WN_NOT_SUPPORTED`, with arguments it takes, on the oracle's Windows, which has no network.

## Inside Windows

- [[read out]] `USER.EXE` seg22: the network driver's function, from the table USER filled as Windows started; with no network driver, 1, `WN_NOT_SUPPORTED` (seg22 `0770`-`0790`). Nothing is checked first.

## Implementation

`src/win16/user/wnet.ts`; the Rust engine's `user_misc.rs`.
