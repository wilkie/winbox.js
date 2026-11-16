---
kind: topic
name: Hardware interrupts
summary: How the timer's interrupt, IRQ 0, reaches a Windows program's own handler of vector 08h in standard and enhanced mode -- KERNEL's INT 21h 25h and 35h, DOSX's reflection, the chain of Windows' own handlers, when the interrupt is ended -- and how WinBox raises it on the machine's clock.
probes: [irqtick]
---

A Windows program can set the handler of a hardware interrupt itself, as a DOS program does: through INT 21h 25h, through DPMI's 0205h, or a real-mode handler through 0201h. `win3_act123_a`'s `DOVOICE.DLL` sets the timer's, 08h, through 25h as it loads (`DOVOICE.DLL` seg1 `00d8`-`00f5`), and its handler (`00fc`, calling `0087`-`00cf`) goes on to the handler before (`pushf`, a far call) and counts ten ticks to time its voice (`0186`-`01c0`).

## The way an INT 21h 25h goes

- [[read out]] KERNEL keeps seven vectors itself, one set for each task in its database: 00h, 02h, 04h, 06h, 07h, 3Eh and 75h (`KRNL386.EXE` seg1 `181c`-`184b`). 25h and 35h of those are KERNEL's own (seg1 `1791`, `17f1`, from the table at seg1 `1a5a` by AH).
- [[read out]] Of the rest, once Windows has started (its byte at 32Ch nought) and runs its shell (its byte at 24Ch one, as from its file), 25h passes over 1Bh, 1Ch, 21h and 24h, setting nothing; anything else goes on to the DPMI host's INT 21h (seg1 `17ab`-`17de`, `1cf9`). [[measured]] [[probe:irqtick]] sets 1Ch through 25h and sees no tick in 1,099 ms, in both modes.
- [[read out]] DOSX's INT 21h 25h makes it the protected-mode vector, as 0205h does (`DOSX.EXE` 186Bh:`039c`, `0cc6`, `1e57`); for 02h, 08h-0Fh, 1Bh, 1Ch, 23h, 24h and 70h-77h it also points the real-mode vector at a stub of its own that takes the interrupt up to protected mode, or gives the real-mode vector back where the handler is DOSX's own (`0cc6`-`0d53`). 0205h sets the protected-mode vector alone. 35h answers the protected-mode vector (`0ca1`, `1e30`).

## Windows' own handlers

- [[read out]] In standard mode TIMER.DRV hooks 08h through 25h as it is enabled (`TIMER.DRV` seg1 `0151`-`016f`), its handler at seg3 `0276`; SYSTEM.DRV hooked it before (`SYSTEM.DRV` seg1 `02e2`-`0309`), its handler at `0238`. [[measured]] [[probe:irqtick]]: the vector a program finds is offset 0276h, owned by TIMER, in standard mode, and 0238h, owned by SYSTEM, in enhanced mode, where TIMER.DRV leaves it alone. 0204h answers the same.
- [[read out]] SYSTEM.DRV's handler adds 54.925 ms to its count -- [[fn:SYSTEM.GetSystemMSecCount]], which [[fn:USER.GetTickCount]] answers -- goes on to the handler before it, and then calls its timers where no interrupt is in service ([[topic:system-driver]]; `0238`-`02d2`).
- [[read out]] DOSX's own handler of 08h (186Bh:`0e48`, one of the stubs from `0e30`) takes the interrupt down to real mode (`148f`-`14fb`), where the BIOS's handler counts the tick, calls INT 1Ch and ends the interrupt at the controller (DOSBox's `CB_IRQ0`, `ints/bios.cpp` 847-858).

## The interrupt reaching a program's handler

- [[read out]] In standard mode the controller's IRQ 0 comes to protected mode as vector 08h, which DOSX's table sends to its exception stubs (`DOSX.EXE` 150Ch:`2390`-`23b5` lays the table out, the stubs at 186Bh:`1130`). Their dispatcher tells an interrupt from a fault by the frame on its own stack: with no error code and a vector of 08h-0Fh it copies the frame -- IP, CS, the flags -- onto the stack interrupted, three words below it, and returns into the handler from the table set by 25h and 0205h (`11f3`-`125f`), its interrupt flag clear.
- [[measured]] [[probe:irqtick]], standard mode: the handler is entered on the task's stack six bytes below the loop it interrupted; the frame's CS is the probe's code, its flags' interrupt flag set; inside the handler the interrupt and trap flags are clear; DS and ES are the program's. Enhanced mode: the handler is entered on another stack, the frame's CS not the program's code but of the third privilege level; the flags and segments as in standard mode. WIN386's code for it is not read out.
- [[measured]] 20 ticks to a handler that goes on to the one before take 1,099 ms by [[fn:USER.GetTickCount]] (1,090-1,110), in both modes, through 25h and through 0205h: 18.2 a second, 65,536 of the 8253's 1,193,180 Hz.
- [[measured]] A handler that goes on to nothing and writes no end of interrupt sees one tick over ten ticks' time, and `GetTickCount` stands still, in both modes: no host ends the interrupt for it, and Windows' count is in a handler further down the chain. An end of interrupt written to port 20h, and the handler before put back, the ticks come again and `GetTickCount` moves.
- [[measured]] A real-mode handler set through 0201h that counts, ends the interrupt and returns sees several ticks over ten ticks' time while the program runs in protected mode, and `GetTickCount` moves: Windows' handlers run first, and the interrupt comes down to real mode. One that jumps on to the vector before hangs standard mode: the vector before is DOSX's own stub, which takes the interrupt up to protected mode again.
- [[measured]] Port 61h, read three times, answers 30h, 00h, 30h in both modes: DOSBox turns bits 4 and 5 over at each read (`hardware/keyboard.cpp` 175-179).

## Implementation

WinBox is KERNEL and the DPMI host (`crates/winbox-win16/src/dos.rs`, `dpmi.rs`, `hardware_interrupts.rs`):

- INT 21h 25h and 35h keep KERNEL's seven vectors for the task, pass over 1Bh, 1Ch, 21h and 24h, and set or answer the rest as 0204h and 0205h do.
- The timer's vector before a program's is TIMER's in standard mode and SYSTEM's in enhanced mode, at the offsets Windows has them in WinBox's modules of those names; each is a far jump on to the host's stub, whose `INT 08h` is Windows' handler here.
- A task runs with its interrupt flag set, as on Windows ([[probe:dpmimem]], [[probe:dpmiexc]]).
- While a program's handler of 08h is set, the timer ticks on the machine's clock every 65,536 of the 8253's cycles, as `GetTickCount`'s ticks are, so a run is the same on any host. A tick is raised between two slices of the program's instructions where its interrupt flag is set and the last tick has been ended: in standard mode on the stack interrupted, three words below; in enhanced mode on the host's stack, returning through the host's code. Where the task waits in the API, the tick comes as a procedure called at interrupt time ([[topic:multimedia-timer]]). Ticks that come while one is in service are one request, as the controller holds one.
- The chain reaching the host's stub ends the interrupt and is Windows' tick; an end of interrupt written to port 20h ends it too. Each tick that never reaches Windows' handler leaves [[fn:USER.GetTickCount]] a tick behind.
- Port 61h is kept and read as DOSBox keeps it; the speaker it gates is not sounded.

[[measured]] WinBox agrees with every record of [[probe:irqtick]] in both modes but the owner of the vector, the real-mode vectors and the real-mode handler (below).

## Not yet done

- A program's real-mode handler, set through 0201h, is never called: WinBox runs no real-mode code of a program's ([[topic:dpmi-functions]]). The real-mode vectors 0200h answers are nought.
- WinBox's modules' code is no block in TOOLHELP's walk, so the owner of the timer's vector before a program's is not found as TIMER or SYSTEM.
- Only the timer's interrupt is raised. The keyboard's, 09h, and the rest are not; nor INT 1Ch set through 0205h, which standard mode's BIOS never reaches.
- A program that sets the 8253's rate through ports 40h-43h is not followed: the ticks stay at 18.2 a second.
- MMSYSTEM's timer events and SYSTEM.DRV's timers keep the clock's time where a program's handler keeps ticks from Windows' own; only `GetTickCount` falls behind.
- WIN386's virtual controller (VPICD) and its stack for an interrupt are measured, not read out.
- The speaker driven through port 61h is not heard.
