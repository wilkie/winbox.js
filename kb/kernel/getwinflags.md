---
kind: function
module: KERNEL
name: GetWinFlags
ordinal: 132
summary: Says what Windows runs on — the mode, the processor, whether there is a coprocessor — as the value KERNEL also exports as __WINFLAGS; standard mode's or 386 enhanced mode's, as the machine is made.
versions:
  '3.1': exact
probes: [winflags]
source: crates/winbox-win16/src/kernel.rs
---

## Observed behaviour

- [[measured]] [[probe:winflags]] records 419h: protected mode (1), a 486 (8), standard mode (10h), and a coprocessor (400h). The oracle's Windows runs as `win /s`, under DOSBox, which gives it a 486 and a coprocessor. winbox.js answers the same.
- [[measured]] In 386 enhanced mode, `win /3`, [[probe:winflags]] and [[probe:dpmiver]] record C29h: protected mode (1), a 486 (8), enhanced mode (20h), a coprocessor (400h) and paging (800h). A WinBox machine made in enhanced mode answers the same ([[guide:enhanced-mode]]).
- [[measured]] KERNEL exports the same value as `__WINFLAGS`, ordinal 178. It is a number, not a function, and `GetProcAddress` answers it in the offset. Libraries read it where they are linked, WIN87EM and TIMER.DRV among them.

## Nuances

- [[read out]] KERNEL learns the mode once, as it starts, from INT 2Fh 1600h: AL 3 is enhanced mode, and it sets `WF_PMODE|WF_ENHANCED`; anything else is standard mode, `WF_PMODE|WF_STANDARD` (`KRNL386.EXE` seg1 `aa76`-`aa90`). WinBox's machine is made in one mode or the other, standard by default, and INT 2Fh 1600h answers by it.

- [[measured]] Before this was recorded, winbox.js said enhanced mode on a 386 with no coprocessor. Standard mode shows: Control Panel's 386 Enhanced applet appears only in enhanced mode, and it is gone, as it is on that Windows.
- Whether there is a coprocessor is a choice of the machine's. Without one, programs' floating-point instructions are emulated, as WIN87EM does, and bit 400h is clear in either mode. [[measured]] [[probe:fpemu]] is recorded on Windows without a coprocessor and finds the bit clear ([[topic:floating-point]]).
