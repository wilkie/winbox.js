---
kind: function
module: KERNEL
name: IsROMModule
ordinal: 323
summary: Whether a module is in ROM — never, on a Windows run from the disk: nought.
source: crates/winbox-win16/src/kernel.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `1e9b`-`1e9d` (`KRNL286.EXE` seg2 `1e97`): `xor ax,ax; retf 6`. Six bytes popped, AX nought. Only the ROM build of Windows had modules in ROM.
- [[read out]] `PROGMAN.EXE` imports it by ordinal; nothing else of the installations or the corpus does (`kb/data/kernel-callers.json`).

## Implementation

`IsRomModule` in `src/win16/kernel/misc.ts`: nought, as KERNEL answers. Answered as a stub, AX was left as it was. That leftover AX once made Control Panel's Fonts fault, as the source records. See [[topic:kernel-internals]].
