---
kind: function
module: MMSYSTEM
name: DriverCallback
ordinal: 31
summary: How a driver calls a program back: a window or a task posted, or a function called.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/mmsystem/callback.rs
topics: [sound-devices]
---

## Observed behaviour

- [[read out]] No probe calls it itself; the Sound Blaster's driver does, and the callbacks it makes are [[probe:wavedev]]'s.

## Inside Windows

- [[read out]] seg1 `3ab`: no callback or no kind answers nought; unless `DCB_NOSWITCH` (8), the call is made on one of MMSYSTEM's stacks. `DCB_WINDOW` (1) posts the window the message, the handle its wParam and the first parameter its lParam; `DCB_TASK` (2) posts it to the task; `DCB_FUNCTION` (3) calls a function in a code segment with the handle, the message, the program's doubleword and both parameters, and answers 1.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/callback.rs`. Neither moves to an interrupt stack for the call: there is no interrupt time to need one.
