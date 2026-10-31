---
kind: function
module: SHELL
name: WCI
ordinal: 32
summary: The subclass procedure of a control of SHELL's About box: its credits, shown on a double click with keys held.
versions:
  '3.1': exact
probes: [ugaps]
records: [wci]
source: src/win16/shell/internal-procs.ts
topics: [user-internals]
---

## Observed behaviour

- [[read out]] Every path ends in `CallWindowProc` of the procedure at 196h of SHELL's data (`0856`, `0970`, `0d9a`), kept as the About box subclassed its icon and nought before; USER's `CallWindowProc` checks the procedure first and refuses a null one through [[fn:KERNEL.K327]], nought (`USER.EXE` seg1 `a827`, `aed0`-`aeed`).
- [[measured]] [[probe:ugaps]], before any About box: `WM_USER`, `WM_PAINT` and `WM_NCDESTROY` on the probe's window each answer nought, ten bytes popped.

## Inside Windows

- [[read out]] `SHELL.DLL` seg9 `0829`: `CallWindowProc` of the procedure kept at `[196h]` for `WM_PAINT`, then a `BitBlt` from SHELL's memory context while its state at `[1A4h]` is 3; `WM_NCDESTROY`, `WM_TIMER` and `WM_LBUTTONDBLCLK` (`0841`-`0850`) run the credits the About box shows.

## Callers

- No file of the installations or the corpus imports it (`kb/data/shell-callers.json`).

## Implementation

**Not applicable (c), with the answer of a call.** Only SHELL's About box reaches it, through the subclass. Both engines answer `CallWindowProc` of nought, the procedure WinBox's About box never keeps, which is nought (`WCI` in `src/win16/shell/internal-procs.ts`). Not done: the About box's credits. See [[topic:user-internals]].
