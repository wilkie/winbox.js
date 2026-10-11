---
kind: function
module: USER
name: Mouse_Event
ordinal: 299
summary: The mouse driver's way into USER, open to a program too — a move, a press or a release put in as the mouse made it, taken by USER's own loops like any other.
versions:
  '3.1': exact
probes: [iconclk, mousemsg, spiidle]
source: src/win16/user/mouse-event.ts
topics: [mouse-input, window-states, hit-testing]
---

## Observed behaviour

`Mouse_Event` is called with registers, not a stack. [[read out]] Its code is at `USER.EXE` seg1 `507a`.

- AX holds the flags. Bit 1 means the mouse moved. Bits 2 and 4 are the left button pressed and released, 8 and 0x10 the right, 0x20 and 0x40 the middle. BX and CX say where.
- The buttons go in first, where the pointer was, and the move after them (`518a`, then `50c5`).
- With bit 0x8000, BX and CX are absolute, 0 to 65535 across the screen. The pointer goes to BX times the screen's width over 65536, and CX times its height over 65536 (`50d7`). Without it, BX and CX are a move in mickeys, doubled where it is more than the mouse's first threshold, and doubled again where it is more than the second and its speed is 2 (`5209`); across, divided by the display's ratio, its remainder kept (`510b`); the pointer then held in [[fn:USER.ClipCursor]]'s rectangle, and nothing put in where it went nowhere (`5172`). [[measured]] [[probe:spiidle]], under six settings of [[fn:USER.SystemParametersInfo]]'s `SPI_SETMOUSE` ([[topic:system-parameters]]).
- Each event put in is noted as the last input, from which the screen saver's delay counts, as a look takes it.

[[probe:iconclk]] finds `MOUSE_EVENT` with [[fn:KERNEL.GetProcAddress]] and calls it with absolute moves and the left button. It presses on an icon and on a caption, drags each, and clicks an icon twice. Everything it puts in reaches Windows' own move loop and menu loop as the mouse would. See [[topic:window-states]] and [[topic:menus]] for what they do with it.

- [[measured]] The pointer lands on the pixel asked for, when the absolute coordinate is rounded up from the pixel's.
- [[measured]] Two presses at the same point, one straight after the other, are a double click.

winbox.js agrees with all of [[probe:iconclk]]'s records.

winbox.js moves the pointer so, without bit 0x8000 too, taking every display's ratio as the VGA's, 1. Which presses make a double click is the look's to say ([[topic:system-queue]]).

## A probe's own mistake

The first versions of [[probe:iconclk]] hung Windows before any mouse input was sent. Its window procedure logged into a buffer through a far pointer the probe had not yet set. So it wrote at 0000:0000, over the interrupt vectors, and the timer's went with them: the tick count stood still and no timer fired. A probe that logs from its window procedure must set its log up before it makes its first window.
