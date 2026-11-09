---
kind: function
module: KERNEL
name: Reserved5
ordinal: 87
summary: Two strings compared without regard to case, as KERNEL makes letters small: -1, 0 or 1.
versions:
  '3.1': exact
probes: [ktask]
records: [string]
source: crates/winbox-win16/src/kernel_calls/retail.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `838e`-`83bf`, with the letters made small at `8400`-`8424`. A to Z, and C0h to DEh but D7h, are made small. The strings are compared byte by byte: -1 where the first ends first or its byte is less, 1 where the second ends first or its byte is less, and nought where they end together.
- [[measured]] [[probe:ktask]]: `abc`/`ABD` -1, `b`/`A` 1, `aB`/`Ab` 0, two empty 0, `a`/empty 1, empty/`a` -1, `À`/`à` 0, `[`/`a` -1, `Z`/`_` 1.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
