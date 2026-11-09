---
kind: function
module: KERNEL
name: DefineHandleTable
ordinal: 94
summary: A table of handles in the task's data segment, which KERNEL kept up to date in real mode; its entries cleared.
versions:
  '3.1': exact
probes: [kmore]
records: [handles]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `03ce`-`0417`. DS must be a block of the global heap (`GlobalHandle`'s own call, seg1 `09dd`); else the answer is nought. The offset, and DS (nought for an offset of nought), are kept in the task's database (TDB 5Ch, 5Eh), and the word at 23Eh of KERNEL's data counts the tables, up for a table and down for nought. A table's first word is its count of entries, and that many words and one more after it are cleared. The answer is one; for an offset of nought, AX is left as `GlobalHandle`'s own call left it, DS's selector.
- [[measured]] [[probe:kmore]]: a table of three entries filled with EEEEh answers one, its count left and four words after it cleared, the fifth left; nought answers DS.

## Nuances

- In protected mode a segment's selector does not change as it moves, and KERNEL never writes into the table after clearing it.

## Implementation

`crates/winbox-win16/src/kernel_calls/more.rs`.
