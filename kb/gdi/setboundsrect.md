---
kind: function
module: GDI
name: SetBoundsRect
ordinal: 193
summary: Resets, sets, enables or disables the bounds GDI keeps of what is drawn in a device context, and answers their state before.
versions:
  '3.1': exact
probes: [bounds]
topics: [drawing-bounds]
---

## Observed behaviour

- [[measured]] A new device context answers 9, `DCB_RESET` and `DCB_DISABLE`: nothing kept and not keeping ([[probe:bounds]]).
- [[measured]] The answer is the state before: `DCB_SET` (3) where the bounds hold something, `DCB_RESET` (1) where not, and `DCB_ENABLE` (4) or `DCB_DISABLE` (8).
- [[measured]] `DCB_ACCUMULATE` with a rectangle takes it in; a rectangle with nothing in it is passed over. A new context's bounds start at nought, not empty: a rectangle 3, 4 to 30, 40 taken in comes back 0, 0 to 30, 40.
- [[measured]] `DCB_RESET` empties them; `DCB_SET` (both) empties them and takes the rectangle in.
- [[measured]] `DCB_ENABLE` and `DCB_DISABLE` together leave them disabled.
- [[measured]] With 8000h in the flags it acts on Windows' own bounds, which a new context keeps from the start; the answer has 8000h in it too.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `0526`. The program's bounds are the context's rectangle at B4h and flags 4 (set) and 8 (enabled) at CCh; Windows' are the rectangle at BCh and flags 1 and 2. A new context has the flags 2 and both rectangles nought (seg1 `0136`).

- The answer is made first, from the flags.
- `DCB_RESET` sets the rectangle to 7FFFh, 7FFFh, 8000h, 8000h and clears the set flag.
- `DCB_ACCUMULATE` with a rectangle: the program's is turned into device units (seg1 `52f5`) and moved by the context's corner on the screen (A2h, A4h); Windows' is taken as it is. Where it has something in it, it is taken into the rectangle and the set flag set.
- `DCB_ENABLE` sets the enabled flag, and `DCB_DISABLE` then clears it.

## Implementation

In both engines as read out, with every call that draws taking what it draws in into the bounds ([[topic:drawing-bounds]]). [[probe:bounds]] agrees in both.
