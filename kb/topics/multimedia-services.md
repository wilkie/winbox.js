---
kind: topic
name: MMSYSTEM's services to drivers
summary: What MMSYSTEM gives the drivers under it and the programs over them besides devices — its interrupt stacks, its task calls, its joystick calls, its version and exit procedure — read out of MMSYSTEM.DLL and measured on the installations with no sound driver and with the Sound Blaster.
probes: [mmmisc]
---

A multimedia driver runs at interrupt time and needs a stack it can trust. An MCI driver runs a task of its own to play in the background, and waits on it. A program asks the joystick where it is. MMSYSTEM has a call for each. Most of them are small, and a driver, not a program, is meant to call them; [[probe:mmmisc]] calls every one, on the installation with no sound driver and on the one with the Sound Blaster (`--display vgasound`). Both engines agree with all 95 of its records on each.

[[topic:sound-devices]] has the devices themselves, and MCI.

## The interrupt stacks

[[read out]] `MMSYSTEM.DLL` seg2 `152`-`282`, seg1 `2bd` and `312`-`3aa`:

- In standard mode -- the mode the oracle records in, and the mode both engines say they are in -- MMSYSTEM allocates its interrupt stacks in one block, fixed and `GMEM_SHARE`. It does so as its first load ends if a waveform or MIDI driver gave it a device, and otherwise at the first [[fn:MMSYSTEM.timeSetEvent]]. In 386 enhanced mode there are none: the virtual machine manager gives drivers their stacks.
- How many: `SYSTEM.INI`'s `[mmsystem]` `StackFrames`, or else one for the timer's driver, one if there is a MIDI device and one if a waveform one. How big: `StackSize`, 600h by default, no less than 40h, made even. A block of 64 K or more, or one KERNEL will not give, is three of 600h.
- [[fn:MMSYSTEM.StackEnter]] takes the next stack down from the block's top. The caller goes on there, with the stack it came from -- its pointer past the return address, and its segment -- the two words on top, and the carry clear. With no stack left, or none made, it puts a word of nought under its return address and sets the carry.
- [[fn:MMSYSTEM.StackLeave]] undoes either. AX, BX and DS are kept by both. [[fn:MMSYSTEM.DriverCallback]] calls both around a callback, unless the driver says `DCB_NOSWITCH`.
- [[measured]] With no sound driver, `StackEnter` leaves the stack segment as it was, two bytes deeper, a word of nought on top, the carry set. With the Sound Blaster, three stacks of 600h are made, 1200h bytes, and `StackEnter` moves to another segment, the stack pointer 11FCh, with the probe's stack pointer on top.

## Tasks

[[read out]] seg1 `264`, seg4 `598`-`5f9`:

- [[fn:MMSYSTEM.mmGetCurrentTask]] is `GetCurrentTask`. [[fn:MMSYSTEM.mmTaskSignal]] posts a task `WM_USER`. [[fn:MMSYSTEM.mmTaskYield]] yields if a message is waiting.
- [[fn:MMSYSTEM.mmTaskBlock]] takes messages until one for no window from 3A0h up, and answers it: windows' messages are dispatched, other task messages dropped.
- [[measured]] With 300h, a window's message, 3A0h and 401h posted, `mmTaskBlock` answers 3A0h, having dispatched the window's message and dropped 300h; 401h is left.

## The joystick

[[read out]] seg8 `0`-`48e`, seg2 `780`-`8e3`:

- As it loads, MMSYSTEM opens the driver `[drivers]` names `joystick` twice, once for each joystick, and asks how many joysticks there are. Neither installation names one.
- Every joystick call answers `MMSYSERR_NODRIVER` (6) with no driver, and [[fn:MMSYSTEM.joyGetNumDevs]] 0; [[fn:MMSYSTEM.joySetCapture]] answers `JOYERR_PARMS` (A5h) for no window before it looks for the driver.
- With a driver, the capabilities, the position and the calibration are its messages; the threshold is MMSYSTEM's own; a capture is a timer whose procedure posts the window the joystick's moves and buttons.

## The rest

- [[measured]] [[fn:MMSYSTEM.mmsystemGetVersion]] is 101h. MMSYSTEM's [[fn:MMSYSTEM.WEP]] answers 1. [[fn:MMSYSTEM.OutputDebugStr]] does nothing in the retail MMSYSTEM.
- [[read out]] `DrvOpen`, `DrvClose`, `DrvSendMessage`, `DrvGetModuleHandle` and `DrvDefDriverProc` are USER's driver calls, jumped to ([[topic:installable-drivers]]).

## Tasks of their own

[[fn:MMSYSTEM.mmTaskCreate]] starts `MMTASK.TSK` with `LoadModule`, a procedure and a double word in its command tail; the task waits for its first event and calls the procedure with the double word on itself (MMSYSTEM seg4 `05fa`; `MMTASK.TSK` seg1). The new task is `LoadModule`'s DX. [[measured]] [[probe:mmtaskc]]. Where the drive has no `MMTASK.TSK`, WinBox starts its own `MMTASK`, made in memory, its start-up calling a procedure of WinBox's kept at MMSYSTEM's ordinal 1204.

## Not yet done

- The joystick's calibration MMSYSTEM sets as it loads, from `[joystick.drv]`'s `JoyCal` keys: no installation here has a joystick driver for it to go to.

## In winbox.js

The stacks are `crates/winbox-win16/src/mmsystem/stacks.rs`; the tasks `crates/winbox-win16/src/tasks.rs`; the joystick `crates/winbox-win16/src/mmsystem/joystick.rs`. The joystick capture's timer procedure has no export in Windows; both engines keep it at an ordinal where MMSYSTEM exports nothing (1203), as they keep MCI's break-key yield procedure (1202), `MMTASK`'s own (1204, `crates/winbox-win16/src/mmsystem/mmtask.rs`) and the I/O procedures of `mmio`.
