---
kind: function
module: KERNEL
name: FlushCachedFileHandle
ordinal: 319
summary: Closes the file handle KERNEL keeps open for a module, so that its file can be changed. Setup calls it.
topics: [kernel-internals, programs-and-their-files]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `52fc`-`5349` (`KRNL286.EXE` seg1 `4b9c`). One word, a module's handle, popped. Nothing is answered; AX, BX, CX and DI are kept.
  1. Nought does nothing (`5309`-`530e`).
  2. KERNEL keeps a cache of open files for the modules it loads from. It is a count at 5F2h of its data and entries from 5F4h, each a DOS handle and the module it belongs to. The call looks for the entry of this module (`5310`-`531f`).
  3. Found, the handle is closed through KERNEL's own `INT 21h` routine, with KERNEL's own prefix made the one the call is made for, and the entry is emptied (`5323`-`533f`).
- [[read out]] The cache is filled by seg1 `5230`-`52ae` as a module's segments or resources are read. A module's entry is reused if it has one; otherwise a free entry is taken, or the next one round, from the word at 5EEh, whose handle is closed. [[fn:KERNEL.WinOldApCall]] closes all of them at once.
- [[measured]] [[probe:kintrnl]]: of nought and of the probe's own module, AX and DX kept and two bytes popped.

## Callers

- [[read out]] `SETUP.EXE` in the Windows directory imports it by ordinal. No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`). [[inferred]] Setup loads modules it later overwrites or deletes, such as drivers it replaces. While KERNEL holds such a module's file open, DOS's sharing would keep it from being written.

## Implementation

A retail no-op, popping two bytes (`nothing` in `crates/winbox-win16/src/kernel_calls/retail.rs`). WinBox's loader works from the module's image as given to it (`crates/winbox-win16/src/loader.rs`), not through a DOS handle in KERNEL's prefix. [[inferred]] No handle of a module's file is left open for a program to run into. If WinBox's file layer turns out to hold a module's file open against writes, this should let it go instead. See [[topic:kernel-internals]].
