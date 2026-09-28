---
kind: topic
name: The multimedia timer
summary: MMSYSTEM's timer services in Windows 3.1 — the periods it offers, a millisecond clock, and events that call a program's procedure at interrupt time, once or every period — measured, and how winbox.js calls a program at interrupt time.
probes: [mmtime]
---

MMSYSTEM keeps a clock to the millisecond, and it calls a program back on time whatever the program is doing. `USER`'s timers can't do that: they arrive as messages. Games use MMSYSTEM's timer to pace themselves. Bubble Girl, Slam! and Flak of the corpus each call it, and Flak drew nothing until it answered.

[[measured]] [[probe:mmtime]] asks each of the timer functions, then sets three events and waits.

## Periods and the clock

- [[fn:MMSYSTEM.timeGetDevCaps]] gives periods from 1 to 65535. Asked with a structure too small, it answers `TIMERR_NOCANDO`, 97, and writes nothing.
- [[fn:MMSYSTEM.timeBeginPeriod]] and [[fn:MMSYSTEM.timeEndPeriod]] answer nought for a period of 1, and 97 for nought. `timeBeginPeriod` answers 97 for 65535 as well, although the device's largest period is 65535.
- [[fn:MMSYSTEM.timeGetTime]] counts from where [[fn:USER.GetTickCount]] counts, a millisecond at a time.
- [[fn:MMSYSTEM.timeGetSystemTime]] answers nought and gives milliseconds, `TIME_MS`, even when asked for samples.

## Events

- [[fn:MMSYSTEM.timeSetEvent]] answers an event's id, or nought for a delay of nought.
- The procedure is called with the event's id, nought, the `DWORD` the program gave, and two noughts.
- `TIME_ONESHOT` calls it once, and the event is then gone. [[fn:MMSYSTEM.timeKillEvent]] of it afterwards answers 97, as for an id that never was.
- `TIME_PERIODIC` calls it every period until `timeKillEvent`, which answers nought. Nothing is called after that.

## Interrupt time

The procedure is called from the timer's interrupt, between two of whatever program's instructions. The probe's procedure loads its own data segment and does not check its stack, because the stack is not the program's. With the usual check, Windows hung.

winbox.js calls such a procedure at one of two points:
- Between two slices of the running task's instructions.
- Inside the API, straight after a task that waits for a message wakes. The event wakes it.

It never calls one while the task is stopped inside some other call of the API, because that call may be calling the program itself. Nor while the processor is at the far call that opens a module's stub segment, where a call begun has not yet been made. That call is shared, so a second call there would write over the first call's target. The rest of the stubs, where each call of the API returns to the program, are as good as the program's own code. Keeping out of all of them kept the calls from a program that calls the API often, since it is nearly always at one when a slice begins.

- [[measured]] The first version kept the events on the host's timers. A program that calls the API over and over without waiting, as the probe's wait does with `GetTickCount` and `PeekMessage`, never gave those timers a turn. Under load, a periodic event was then called once or not at all. The scheduler now looks at the clock between slices, as it does for `USER`'s timers.
- Not recorded: the registers and the stack Windows calls the procedure with. winbox.js calls it with DS and AX the stack's segment, as for a hook, on the task's stack. Also not recorded: the event ids themselves, which winbox.js counts from 1, and what becomes of a task's events when it ends. Here they stop.

## In winbox.js

`src/win16/mmsystem/time.ts` has the functions and `pollTimeEvents`. `Scheduler.atInterrupt`, `deliverInterrupt` and `takeInterrupts` in `src/win16/scheduler.ts` make the calls, and `src/win16/user/queue.ts` takes them as a task wakes from waiting for a message.
