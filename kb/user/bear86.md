---
kind: function
module: USER
name: Bear86
ordinal: 86
summary: The icon's width and height as USER read them from the display driver.
versions:
  '3.1': exact
probes: [userint]
records: [bear]
topics: [small-queries]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:userint]]: `00200020`, 32 by 32, on the VGA.

## Inside Windows

- [[read out]] `USER.EXE` seg13 `0229`: AX `[68Ah]` and DX `[68Ch]`, which USER read from the display driver's resources as it started (seg3 `0e2c`-`0e68`), the icon's width and height its icon code scales by (seg12).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. `SM_CXICON` and `SM_CYICON`, which WinBox has from the same resources.
