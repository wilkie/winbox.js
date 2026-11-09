---
kind: function
module: KERNEL
name: SetSigHandler
ordinal: 140
summary: Sets the running task's action and handler for Ctrl+Break, the one signal (1) it takes, answering the old ones through two far pointers.
versions:
  '3.1': exact
probes: [kgaps]
records: [sig]
source: crates/winbox-win16/src/kernel_calls/signals.rs
topics: [kernel-internals, keyboard-driver]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `068c`-`06f0` (the same offset in `KRNL286.EXE`). Five arguments, sixteen bytes popped. In the order pushed they are the new handler (a far procedure, BP+12h), a far pointer for the old handler (BP+0Eh), a far pointer for the old action (BP+0Ah), the action (BP+8), and the signal (BP+6). It answers nought in AX always.
  1. A signal other than 1 does nothing (`0695`-`0699`).
  2. With an action other than 4, the action is exchanged with the word at 24h of the running task's database, and the old one is written through its pointer where that is not nought (`069b`-`06b6`).
  3. The handler is exchanged with the far pointer at 26h of the task's database. With action nought, the handler set is KERNEL's own default, a bare `RETF` at seg1 `6125`, rather than the one passed (`06b9`-`06cf`). The old handler is written through its pointer, unless the action is 4 or the pointer is nought (`06d3`-`06e6`).
- [[read out]] With action 4 the task's database is never loaded into DS (`069b`-`069f` jumps past it), so the exchange of step 3 is made with the words at 26h and 28h of KERNEL's own data instead.
- [[read out]] With an action other than 4 and a null pointer for the old handler, the routine leaves through a path that skips its `pop ds` (`06e0`-`06ea`). The selector of KERNEL's data, pushed before DS was made the task's database, is then popped into DI, the caller's DI into SI and the caller's SI into DS. So the caller gets back DS, SI and DI not as it left them.
- [[read out]] [[fn:KERNEL.DOSignal]] calls the handler only when the action is 2.
- [[measured]] [[probe:kgaps]]: signal 2 changes nothing, AX nought and DX kept. For signal 1 a task starts with action nought and KERNEL's own handler; each call answers the old ones through the pointers and DX the old handler's selector; action nought sets KERNEL's handler; action 4 writes neither old one, DX the old of KERNEL's own words, nought at first. With no pointer for the old handler, DS comes back the caller's SI, SI its DI and DI KERNEL's data.

## Callers

- No file of the installations or the corpus imports it, and none holds its name (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (a).** Both engines keep a task's action and handler in their record of it (TDB 24h, 26h), and KERNEL's own pair for action 4, and answer as above, the stray registers too (`SetSigHandler` in `src/win16/kernel/signals.ts`, `kernel_calls/signals.rs`). KERNEL's own handler, a bare `RETF` at seg1 `6125`, is WinBox's `ValidateFreeSpaces` stub, a bare return in Windows as here ([[probe:kintrnl]]). See [[topic:kernel-internals]].
