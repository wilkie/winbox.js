---
kind: function
module: SYSTEM
name: Save80x87State
ordinal: 8
summary: The coprocessor's state written as FSAVE writes it, the unit then reset.
versions:
  '3.1': exact
probes: [sysdrv]
records: [x87]
topics: [system-driver, floating-point]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: after `FNINIT`, `FLD1` and `FLDPI`, the control word 037Fh, the status word 3000h (two pushed) and the tag word 0FFFh, and π and 1 as the two registers' ten bytes each.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `0177`: `FSAVE` at the far pointer, which also resets the unit as `FNINIT` does.

## Implementation

`src/win16/system-driver.ts`; the Rust engine's `crates/winbox-win16/src/system_driver.rs`. WIN87EM's own `FSAVE` of the unit (`win87em.ts`, `win87em.rs`'s `save_unit`).
