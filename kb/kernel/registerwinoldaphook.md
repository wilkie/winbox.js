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
- [[measured]] [[probe:kintrnl]] adds two records and takes them out again. The chain is empty to begin with. A record added answers 1, and its link is the old head. Taking out the second of two answers 1 and puts its link in the first. Taking out a record that is not there answers nought, and so does taking out the last one twice. A flag of 100h, whose low byte is nought, takes the record out. DX is kept throughout.

## Callers

- No file of the installations or the corpus imports it (`kb/data/kernel-callers.json`). [[inferred]] It is for a library outside Windows, a network's or a resident program's, that must act as standard mode switches to a DOS program and back.

## Implementation

Both engines keep the chain as Windows does, in the caller's own records, linked through their first four bytes: `src/win16/kernel/internals.ts` and `crates/winbox-win16/src/kernel_calls/internals.rs`. WinBox reports standard mode, so the record is always taken. No procedure in the chain is ever called, since WinBox runs no DOS session. See [[topic:kernel-internals]].
