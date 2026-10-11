---
kind: function
module: USER
name: LockInput
ordinal: 226
summary: Locks the input to one window and runs no other program until it is let go, as a debugger shows its own window; or lets it go.
versions:
  '3.1': exact
probes: [lockinp]
source: src/win16/user/lock-input.ts
topics: [system-queue]
---

## Observed behaviour

[[read out]] `USER.EXE` seg1 `4983` takes a handle that must be nought, the window, and whether to lock. It answers nought for a handle that is not nought; to lock, where the input is locked already, the window is nought or a child, or the 1Ch bytes it keeps cannot be had from USER's heap; and to let go, where nothing is locked. Locking, it locks the running task with [[fn:USER.LockMyTask]], so no other program runs, and makes the window the focus, the active window and the system-modal window, lets the capture go, makes the cursor's clip the screen, and switches the hardware input on -- keeping each as it was, and sending no window a message. Letting go puts each back. [[topic:system-queue]] has the whole of it.

[[measured]] [[probe:lockinp]]: the four refusals answer nought and change nothing. Locked to `L`: 1; the focus, the active window and the system-modal window `L`, no capture, the clip the screen, and [[fn:KERNEL.IsTaskLocked]] the probe's task; another program posted a message does not answer until the lock is let go; a key goes to `L`, even with the hardware input switched off before. Let go: 1, and all as it was.

Both engines followed none of this before: it was a stub. Not followed: the desktop window given to the window's task, and the words of USER's menu and dialog loops it keeps.
