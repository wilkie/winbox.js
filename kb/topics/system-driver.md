---
kind: topic
name: The system driver
summary: SYSTEM.DRV -- the timer's resolution and a drive's kind for KERNEL, the millisecond count USER's GetTickCount is, the coprocessor's state, and eight timers called at interrupt time -- and how WinBox's own stands in for it.
probes: [sysdrv]
---

`SYSTEM.DRV` is the driver KERNEL and USER build on: KERNEL asks it what a drive is ([[fn:SYSTEM.InquireSystem]]), USER's [[fn:USER.GetTickCount]] is its [[fn:SYSTEM.GetSystemMSecCount]], and it keeps eight timers its INT 8 handler calls ([[fn:SYSTEM.CreateSystemTimer]]). A program may import it as `SYSTEM`; few do.

## WinBox's own

WinBox keeps a module of its own under the driver's name ([[guide:without-windows]]): it answers each export as the driver does, with KERNEL's and USER's own answers where the driver's are theirs. [[measured]] [[probe:sysdrv]] calls every export, and both engines agree with all 31 records.

- [[read out]] The timers are kept in the module's data where the driver keeps them, from 18h, so that a handle -- the place's offset -- is what a program gets on Windows. Four places are held by Windows' own as a program starts: COMM.DRV's, DISPLAY's cursor check, KERNEL's and USER's ([[fn:SYSTEM.CreateSystemTimer]]). WinBox does not call those.
- A program's timer is called at interrupt time, as MMSYSTEM's timer events are ([[topic:multimedia-timer]]): between two of the task's instructions, with AX its handle and DS the driver's data, for each 54.9254-millisecond tick passed.

## Not yet done

- The held places' counts are not kept in step with what their owners do: USER makes its timer again with a new rate as its own timers change.
- [[fn:SYSTEM.DisableSystemTimers]] stops only a program's timers here; on Windows it stops the cursor and the serial ports too. Nothing has been seen to call it.
