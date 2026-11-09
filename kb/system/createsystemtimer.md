---
kind: function
module: SYSTEM
name: CreateSystemTimer
ordinal: 2
summary: A procedure called at interrupt time every so many milliseconds, kept in one of the driver's eight places; the handle is the place.
versions:
  '3.1': exact
probes: [sysdrv]
records: [timer]
topics: [system-driver]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: the first handle a program is given is 38h, and four can be made; the fifth is nought. A handle freed is given again.
- [[measured]] The procedure is called, with AX its handle, at 110 milliseconds and at nought (every tick).

## Nuances

- [[read out]] Four places are held as a program starts, by Windows' own: COMM.DRV's 100-millisecond timer (`COMM.DRV` seg1 `0126`), DISPLAY's cursor check every tick (`USER.EXE` seg3 `02fa`-`0302`), KERNEL's every nine ticks, and USER's own, which it makes again whenever its own timers change (seg1 `738f`). [[measured]] a diagnosis run of [[probe:sysdrv]]'s kind read the driver's data: those four, owned by COMM, DISPLAY, KERNEL and USER.
- [[read out]] The rate is ticks, its milliseconds times 1,000 divided by 54,925, rounded down: under 55 milliseconds is every tick (`033c`-`034b`).

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `032a`-`037e`. A place is four words: the rate, the count, and the procedure; FFFFh in the rate is a free place, and FFFFh twice ends the eight.
- [[read out]] The driver's INT 8 handler (`0238`-`02d2`) counts each place's count down every tick and calls its procedure as it comes to nought, its count set back to its rate; a rate of nought is called every tick. AX is the handle, DS the driver's data.

## Implementation

`crates/winbox-win16/src/system_driver.rs`. The places are kept in the module's data at the driver's offsets, the four held laid out as the driver is first called; a held place has no procedure and is only counted. A program's procedure is called as MMSYSTEM's timer events are, at interrupt time between two of the task's instructions (`Scheduler.atInterrupt`, the registers given), for each tick passed since the clock was last looked at, at most 64.
