---
kind: function
module: USER
name: GetDC
ordinal: 66
summary: A device context for a window's client area or the screen, from USER's cache; one given back still answers, and the next asked for the same place is the same handle.
versions:
  '3.1': exact
probes: [reldc]
source: src/win16/user/GetDC.ts
topics: [standard-controls]
---

## Observed behaviour

[[measured]] [[probe:reldc]] asks for the screen's device context, gives it back with [[fn:USER.ReleaseDC]], and goes on asking it.

- **Given back, it still answers.** [[fn:GDI.GetNearestColor]] of AAAAAAh and 555555h answer C0C0C0h and 808080h, and [[fn:GDI.GetDeviceCaps]] answers 1 bit a pixel in 4 planes, as for one held.
- **The same again.** The next `GetDC(NULL)` answers the handle given back.

The device contexts `GetDC` gives out are USER's cache of a few, lent and given back. A handle given back is one of them still, so what is asked of it is answered.

[[measured]] [[probe:dcreuse]] asks which handle comes next for another place, records only whether two handles are the same, and found none given again for a place other than its own: a window's given back, the screen's is another handle; the screen's given back, another window's is another; two windows' given back in either order, the screen's is neither; a window's given back, a minimized window's is another, and that one's given back, the screen's another. Held at once, six of the screen's are five distinct handles: with the five all lent, Windows lends one of them again. Both engines answer the first six so; the sixth they make anew (`dcreuse:held`, a known gap). Widget Workshop's installer, run under both engines, led here: the Rust engine let go of a different handle from the TypeScript engine's, through erasing a minimized window's title, which is now passed over in both as a window that paints itself is not.

## Why it matters

Reversi asks `GetNearestColor` of a device context it has given back, and makes its board's brushes of the answer. winbox.js freed the handle, answered -1, and the board's grey came out white. The screen went from 53,676 pixels unlike Windows' to 19,349.

## In winbox.js

A handle given back is kept, still standing for its surface, and given out again for the same surface. Five are kept, as USER's cache has five, the one given back longest ago let go first.

A window's context comes with its visible region worked out by USER's rule, as `GetDCEx` with `DCX_USESTYLE` gives it: what shows of the client area, siblings above taken out where `WS_CLIPSIBLINGS` says, children where `WS_CLIPCHILDREN` does, cut to each parent and the screen, nothing for a hidden or minimized window or one within the window `LockWindowUpdate` locked ([[topic:visible-regions]]; [[probe:visrgn]], [[probe:visrule]]). `GetClipBox`, `RectVisible` and `PtVisible` answer by it.
