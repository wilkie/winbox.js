---
kind: function
module: USER
name: EnableHardwareInput
ordinal: 331
summary: Switches the keyboard's and the mouse's input on or off, answering whether it was on.
versions:
  '3.1': exact
probes: [lockinp]
source: src/win16/user/lock-input.ts
topics: [system-queue]
---

## Observed behaviour

[[read out]] `USER.EXE` seg1 `4f36` exchanges the word at `46h` of USER's segment 44 for the one given, and answers what was there: 1 at first. While it is nought, `KEYBD_EVENT` and `MOUSE_EVENT` put nothing in the system queue (`4be3`). [[fn:USER.LockInput]] switches it on while it locks, and puts back what it was as it lets go.

[[measured]] [[probe:lockinp]]: switched off, it answers 1, and a key put in reaches no window. Switched on again, it answers nought, and the next key reaches the window with the focus.

Both engines followed none of this before: it was a stub.
