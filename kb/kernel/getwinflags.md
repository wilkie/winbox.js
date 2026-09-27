---
kind: function
module: KERNEL
name: GetWinFlags
ordinal: 132
summary: Says what Windows runs on — the mode, the processor, whether there is a coprocessor — as the value KERNEL also exports as __WINFLAGS.
versions:
  '3.1': exact
probes: [winflags]
source: src/win16/kernel/GetWinFlags.ts
---

## Observed behaviour

- [[measured]] [[probe:winflags]] records 419h: protected mode (1), a 486 (8), standard mode (10h), and a coprocessor (400h). The oracle's Windows runs as `win /s`, under DOSBox, which gives it a 486 and a coprocessor. winbox.js answers the same.
- [[measured]] KERNEL exports the same value as `__WINFLAGS`, ordinal 178. It is a number, not a function, and `GetProcAddress` answers it in the offset. Libraries read it where they are linked, WIN87EM and TIMER.DRV among them.

## Nuances

- [[measured]] Before this was recorded, winbox.js said enhanced mode on a 386 with no coprocessor. Standard mode shows: Control Panel's 386 Enhanced applet appears only in enhanced mode, and it is gone, as it is on that Windows.
- Whether there is a coprocessor is to become a choice of the machine's. Without one, programs' floating-point instructions are to be emulated, as WIN87EM does.
