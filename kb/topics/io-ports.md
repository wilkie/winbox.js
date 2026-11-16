---
kind: topic
name: I/O ports
summary: A Windows program's own IN and OUT -- the privilege they run at in standard and enhanced mode, which devices answer them, and the ports WinBox answers as the oracle's DOSBox does: the CMOS's 64 registers, the 8253's counters, DMA channel 0, the game port, the VGA's input status.
probes: [ioports]
---

A Windows 3.1 program can read and write the machine's I/O ports itself. Windsock times a run of `IDIV`s on the 8253's counter 2 (`WINDSOCK.EXE` file offset `22900`-`2294d`) and sets counter 0 to mode 2 and latches it for a finer time than a tick (`9e86`-`9edd`); Windsock and Windows Speed read the CMOS's 64 registers one by one through ports 70h and 71h, with interrupts off, for their system pages (`winspeed.exe` file offset `887d`-`88a9`); WinWayout waits for the VGA's vertical retrace at 3DAh before it draws (`WINWAY2.EXE` `2a3a`-`2a52`); SmartSurf reads its modem's status register, the COM port's base and 6, port 0 where no port was chosen (`SMARTSRF.EXE` `37680`-`3769f`); BrainCubes, Blackout and BartEyes turn the speaker on and off through port 61h, and Merlin and WordMan read it ([[topic:hardware-interrupts]]).

## The privilege

- [[read out]] In standard mode DOSX enters protected mode with IOPL 3: after loading the task register it pushes FLAGS with bits 12 and 13 set and returns to ring 3 with `iret` (`DOSX.EXE` file offset `111b`-`1131`: `pushf`, `pop ax`, `or ah,30h`, `push ax`, `iret` to 005Bh:`0b51`). A program at ring 3 then reaches every port without a fault, as a 286 checks IOPL alone.
- [[measured]] [[probe:ioports]]: the probe runs at privilege 3 in both modes; PUSHF shows IOPL 3 in standard mode and IOPL 0 in 386 enhanced mode, the interrupt flag set in both. The program cannot change it: after a POPF of 0202h, and after DPMI's 0300h simulating INT 12h with the structure's flags nought, IOPL is as it was in each mode, as a 386 keeps IOPL through POPF and IRET at a privilege but 0.
- [[measured]] No `IN` or `OUT` the probe makes faults in either mode -- ports 0000h, 0001h, 0070h, 0071h, 0201h, 03DAh, and a write to 343Ah, a port no device decodes: in enhanced mode WIN386 takes each through the TSS's permission bitmap, and its virtual devices answer or pass it on. [[inferred]] Every byte the probe reads is the same in both modes, so those ports are the machine's own below Windows in both; which WIN386 virtualises is not read out.

## What the oracle's machine answers

The oracle's DOSBox (0.74-3, `machine=svga_s3`) is the machine below Windows; its devices answer.

- [[measured]] [[probe:ioports]] The CMOS, each register chosen at 70h and read at 71h: the clock's registers (00h, 02h, 04h, 06h-09h, 32h) are each two BCD digits; status A 26h (its update bit masked), B 02h, C 00h (its two timer bits masked), D 80h; 14h the equipment byte 26h; 15h-16h 80h 02h; 17h-18h and 30h-31h 00h 3Ch; every other register 00h, the floppy drives' and the hard disks' among them. [[read out]] DOSBox's `cmos_readreg` (`hardware/cmos.cpp` 127-285) answers the clock from the host's time, BCD while status B's bit 2 is clear; status A's update bit in the first 0.002 of each millisecond; status C's periodic bit once each period of status A's rate and its update-ended bit once a second, where the periodic interrupt is off; the floppy drives' and hard disks' from the images mounted, none here; the rest as last written, its start writing A, B, D and the memory sizes (297-319).
- [[measured]] The 8253's counter 2, as Windsock uses it: control word B8h to 43h (counter 2, both bytes, mode 4), gated on through port 61h's bit 0, 0000h written to 42h a byte at a time; read twice a while apart, the first is not nought and the second below it; the read-back command E8h then latches its status, B8h (output high, both bytes, mode 4). [[read out]] DOSBox's counter (`hardware/timer.cpp`) counts down from the count written at 1,193,182 Hz from the time it was written, and on past its terminal count in modes 0 and 4 (`counter_latch`, 135-189); each whole count read is latched afresh as its first byte is read (`read_latch`, 250-289); the gate, port 61h's bit 0 (`keyboard.cpp` 182-188), stops it in modes 0, 2 and 3 and starts it again (`TIMER_SetGate2`, 363-395); with the gate off but in mode 1 no count is latched. It starts in mode 3 at 1,320, the gate off (402-448).
- [[measured]] The 8253's counter 0, as Windsock uses it: control word 34h (mode 2, both bytes), 0000h written to 40h; latched by control word 00h and read twice a while apart, the first is not nought and the second another; its status by the read-back command E2h, B4h (output high, both bytes, mode 2). Alike in both modes. [[read out]] DOSBox's counter 0 starts in mode 3 from 0000h; its count starts again at each of its interrupts, and a new count in mode 2 takes effect at the next (`PIT0_Event`, 68-79).
- [[measured]] DMA channel 0's address (0000h) and count (0001h), each read twice for the controller's two bytes: 00h each time. [[read out]] Nothing programs channel 0; DOSBox makes it nought (`hardware/dma.cpp` 266-269) and its read gives the low byte, then the high, by the flip-flop (221-241).
- [[measured]] The game port, 0201h: FFh. [[read out]] With no joystick, neither stick is enabled and `read_p201` answers every bit set (`hardware/joystick.cpp` 54-87).
- [[measured]] The VGA's input status, 03DAh, read 200,000 times: bit 3 (vertical retrace) and bit 0 (display disabled) each seen set and clear, no other bit set. [[read out]] `vga_read_p3da` (`hardware/vga_misc.cpp` 33-57) sets bit 3 in the frame's vertical retrace and bit 0 in the vertical blank or a line's horizontal blank, by the time into the frame. `VGA.DRV` sets mode 12h with `INT 10h` (seg4 `00d0`); DOSBox's BIOS writes the CRTC for the mode's 100 characters by 525 lines, 80 by 480 shown (`ints/int10_modes.cpp` 54, 768-866), and `VGA_SetupDrawing` (`hardware/vga_draw.cpp` 1000-1180) makes it a character clock of 25.175 MHz over 8 (`vga_s3.cpp` 498-509), the horizontal blank characters 80-98, the vertical retrace lines 490-492, the display lines 0-479: a frame of 16.68 ms, 59.94 a second.

## Implementation

The processor stops before each `IN` and `OUT` for the host to run it (`crates/winbox-cpu`, `Cpu::ports`), and WinBox answers the machine's ports (`crates/winbox-win16/src/ports.rs`, `cmos.rs`):

- At a privilege above IOPL in protected mode, with no permission bitmap to take it, `IN` and `OUT` raise a general protection fault (`Cpu::io_bitmap` off). A program's task runs with IOPL 3 in standard mode, as DOSX gives it, and at IOPL 0 with the bitmap in enhanced mode, as WIN386 runs it: in both every `IN` and `OUT` reaches the ports. `POPF` and `IRET` at a privilege but 0 keep IOPL, and DPMI's 0300h gives the caller's back with the arithmetic flags.
- The CMOS's 64 registers are read and written as DOSBox's are, the clock's from the machine's date and time, status A and C from the machine's clock.
- The 8253's three counters are DOSBox's, on the machine's clock: control words and the read-back command at 43h, counts at 40h-42h (41h read only), counter 2's gate at 61h's bit 0, counter 0 starting again at each of its periods (`pit.rs`).
- DMA channel 0's address and count read nought; the game port FFh; 3DAh, with the VGA's driver, by the time into a frame of mode 12h on the machine's clock, the frames counted from its start.
- The FM chip's ports, port 61h and the controller's 20h as before ([[topic:hardware-interrupts]]).

## Not yet done

- A port the machine does not answer stops the run where it is read: the serial ports' UART registers (3F8h-3FFh, 2F8h-2FFh, DOSBox's dummy ports), the keyboard controller's 60h and 64h, the interrupt controllers' reads, the rest of the DMA controllers, the VGA's other registers, the Sound Blaster's own, and the ports no device decodes, which DOSBox answers FFh (`hardware/iohandler.cpp` 34-47).
- A count or mode written to counter 0 does not move the timer's interrupt WinBox raises for a program's handler ([[topic:hardware-interrupts]]): its ticks stay at 18.2 a second from the clock's start.
- 3DAh is answered with the VGA's driver only; the other displays' modes have their own timings.
- The CMOS's floppy register, 10h, with a floppy image mounted is not answered: its type follows the image's size (`ints/bios_disk.cpp` 32-44, 249-253).
- The CMOS's periodic interrupt (IRQ 8) is never raised; status C reads nought while status B turns it on.
- The BIOS's data area at 40:00h, where the serial ports' bases are, is not laid out: RS232 Serial Monitor reads the bases there through `__0000H` and reads nought.
- Which ports WIN386's virtual devices trap and virtualise is measured for these alone, not read out.
