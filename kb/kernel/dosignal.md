---
kind: function
module: KERNEL
name: DOSignal
ordinal: 139
summary: Ctrl+Break, from the keyboard driver. It finds the task whose window has the focus and calls the signal handler that task set with SetSigHandler, if it asked for one.
versions:
  '3.1': partial
probes: [kgaps]
records: [dosignal, dosignalds]
source: crates/winbox-win16/src/kernel_calls/signals.rs
topics: [kernel-internals, keyboard-driver]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `612c`-`6173` (`KRNL286.EXE` seg1 `59c5`). No arguments; every register is kept.
  1. Unless KERNEL found USER's procedures while it started, it does nothing. They are USER's `GetFocus`, `IsWindow` and `GetWindowTask`, ordinals 23, 47 and 224, which KERNEL looks up from its strings `#23`, `#47` and `#224` and keeps at 2ECh, 2F4h and 2F0h (seg1 `b81d`-`b84f`).
  2. It asks `GetFocus`. With no focus, or a window `IsWindow` refuses, it does nothing (`6140`-`6151`).
  3. It takes the window's task with `GetWindowTask`. If that task's database has 2 at 24h, the action [[fn:KERNEL.SetSigHandler]] set, it calls the handler at 26h of the database. It pushes nought, then 1, with DS the task's database (`6154`-`6168`).
- [[measured]] [[probe:kgaps]]: with the probe's window focused and action 2 set, its handler is called once, nought pushed first and 1 after, AX 1, BX nought, DS the task; with no focus, or action 0 or 1, it is not called. Every register is kept, nothing popped.

## Callers

- [[read out]] `KEYBOARD.DRV` imports it by ordinal and calls it from its keyboard interrupt, through seg10 `03bc`, when scan code 46h comes with Ctrl down, the Break key (KEYBOARD seg10 `0273`-`0283`, `033e`-`034c`). No other file of the installations or the corpus imports it (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (a).** Both engines take the focus window's task and, where its action is 2, call its handler with the two words, AX 1 and BX nought, every register kept (`DoSignal` in `crates/winbox-win16/src/kernel_calls/signals.rs`). WinBox's keyboard driver is its own and does not call it on Ctrl+Break.

## Not yet done

- DS the task's database for the handler (`kgaps:dosignalds`, a known gap): WinBox's task handles are not selectors of a database, and the handler finds DS as its caller left it.
- Ctrl+Break from WinBox's keyboard calling it, as `KEYBOARD.DRV` does.
