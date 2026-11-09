---
kind: function
module: KERNEL
name: AllocCStoDSAlias
ordinal: 170
summary: A data selector for a code segment's memory, so that code can be written through it — the twin of the declared AllocDStoCSAlias, which no SDK header declares.
source: crates/winbox-win16/src/modules_kernel.rs
topics: [kernel-internals]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `00d0`-`00e1` (the same offset in `KRNL286.EXE`). One word, a selector, popped. It is built as its neighbour [[fn:KERNEL.AllocDStoCSAlias]] at seg1 `00e4` is: the offset of its own `RETF 2` is pushed as the place to return to on an error, the selector is checked (seg1 `0824`), and it goes on to its own routine at seg1 `21a1` (`AllocDStoCSAlias` to seg1 `217a`).
- [[read out]] The census reads it imported by eleven files of the installations: the display drivers, `COMM.DRV`, `KEYBOARD.DRV`, `OLECLI.DLL` and `TOOLHELP.DLL`, which plants its breakpoints through one ([[fn:KERNEL.CVWBreak]]). It is also imported by seven of the 37 corpus programs (`kb/data/kernel-callers.json`). No SDK header in the census's source declares it, though its twin is declared.

## Implementation

`AllocCSToDSAlias` in `src/win16/kernel/selector-aliases.ts`, as `AllocDStoCSAlias` with the alias made data. See [[topic:kernel-internals]].
