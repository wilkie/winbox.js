---
kind: function
module: LZEXPAND
name: ___EXPORTEDSTUB
ordinal: 12
summary: An export of the C library's, named in LZEXPAND's resident names -- it answers nought.
versions:
  '3.1': unrecorded
source: src/win16/lzexpand/index.ts
topics: [compressed-files]
---

## Observed behaviour

- [[read out]] `LZEXPAND.DLL` seg11 `035e`: `sub ax, ax`, and return, popping nothing. It is in the resident name table, as LZEXPAND's name and `WEP` are; nothing in LZEXPAND calls it.

## Implementation

`ExportedStub` in `src/win16/lzexpand/index.ts` and `exported_stub` in `crates/winbox-win16/src/lzexpand/mod.rs` answer nought.
