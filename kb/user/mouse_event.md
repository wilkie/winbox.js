---
kind: function
module: USER
name: Mouse_Event
ordinal: 299
summary: The mouse driver's way into USER, open to a program too — a move, a press or a release put in as the mouse made it, taken by USER's own loops like any other.
versions:
  '3.1': exact
probes: [iconclk, mousemsg]
source: src/win16/user/mouse-event.ts
topics: [mouse-input, window-states, hit-testing]
---

## Observed behaviour

`Mouse_Event` is called with registers, not a stack. [[read out]] Its code is at `USER.EXE` seg1 `507a`.

- AX holds the flags. Bit 1 means the mouse moved. Bits 2 and 4 are the left button pressed and released, 8 and 0x10 the right, 0x20 and 0x40 the middle. BX and CX say where.
- The buttons go in first, where the pointer was, and the move after them (`518a`, then `50c5`).
- With bit 0x8000, BX and CX are absolute, 0 to 65535 across the screen. The pointer goes to BX times the screen's width over 65536, and CX times its height over 65536 (`50d7`). Without it, the move is scaled by the mouse's speed and acceleration (`5209`).

[[probe:iconclk]] finds `MOUSE_EVENT` with [[fn:KERNEL.GetProcAddress]] and calls it with absolute moves and the left button. It presses on an icon and on a caption, drags each, and clicks an icon twice. Everything it puts in reaches Windows' own move loop and menu loop as the mouse would. See [[topic:window-states]] and [[topic:menus]] for what they do with it.

- [[measured]] The pointer lands on the pixel asked for, when the absolute coordinate is rounded up from the pixel's.
- [[measured]] Two presses at the same point, one straight after the other, are a double click.

winbox.js agrees with all of [[probe:iconclk]]'s records.

Not modelled: a move without bit 0x8000; winbox.js leaves the pointer where it is. Not measured: how far apart a double click's two presses may be. winbox.js takes them as one only at the same point.

## A probe's own mistake

The first versions of [[probe:iconclk]] hung Windows before any mouse input was sent. Its window procedure logged into a buffer through a far pointer the probe had not yet set. So it wrote at 0000:0000, over the interrupt vectors, and the timer's went with them: the tick count stood still and no timer fired. A probe that logs from its window procedure must set its log up before it makes its first window.
