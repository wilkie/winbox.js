---
kind: function
module: KERNEL
name: RegisterWinOldApHook
ordinal: 343
summary: Adds a record to, or takes one from, the chain of procedures standard mode's WinOldAp calls around a DOS session; refused (nought) outside standard mode.
topics: [kernel-internals, task-list]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `0689`-`06f0` (the same offset in `KRNL286.EXE`). Its arguments are a far pointer to a record and a flag, six bytes popped (the record is the first pushed, BP+8; the flag's low byte is at BP+6).
  1. Unless bit 4 of the word at 324h of KERNEL's data, `WF_STANDARD` of [[fn:KERNEL.GetWinFlags]], is set, it answers nought and does nothing (`0691`-`069f`).
  2. Flag not nought: the record is put at the head of the chain whose head is the far pointer at 336h. Its first four bytes are given the old head, and it answers 1 (`06a1`-`06c4`).
  3. Flag nought: it walks the chain for the record, unlinks it, and answers 1 (`06c6`-`06e0`). It answers nought if the record is not in the chain.
- [[read out]] A record is a far pointer to the next record, then a far procedure, at 4. [[fn:KERNEL.GetWinOldApHooks]] answers the head, and `WINOLDAP.MOD` calls each procedure in turn with one word ([[fn:KERNEL.GetWinOldApHooks]]).
- Not yet measured.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`). [[inferred]] It is for a library outside Windows, a network's or a resident program's, that must act as standard mode switches to a DOS program and back.

## Implementation

A stub in both engines, which pops six bytes and leaves AX as it was.

**Recommendation: implement as Windows does, the chain without the calls.** WinBox reports standard mode, 419h ([[fn:KERNEL.GetWinFlags]], as the oracle's `win /s` does). So Windows would take the record and answer 1, and [[fn:KERNEL.GetWinOldApHooks]] would then answer it. Keeping the chain in the caller's own records, linked through their first four bytes, makes both calls exact. No procedure is ever called, since WinBox runs no DOS session. That is about 25 lines in each engine, with a probe to record the 1, the link written into the record, and the head. See [[topic:kernel-internals]].
