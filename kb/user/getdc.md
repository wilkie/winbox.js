---
kind: function
module: USER
name: GetDC
ordinal: 66
summary: A device context for a window's client area or the screen, one of USER's five common ones or the window's own; one given back still answers, and the next asked for the same place is the same handle.
versions:
  '3.1': exact
probes: [reldc, dcreuse, dcentry]
source: crates/winbox-win16/src/get_dc.rs
topics: [standard-controls]
---

## Observed behaviour

[[measured]] [[probe:reldc]] asks for the screen's device context, gives it back with [[fn:USER.ReleaseDC]], and goes on asking it.

- **Given back, it still answers.** [[fn:GDI.GetNearestColor]] of AAAAAAh and 555555h answer C0C0C0h and 808080h, and [[fn:GDI.GetDeviceCaps]] answers 1 bit a pixel in 4 planes, as for one held.
- **The same again.** The next `GetDC(NULL)` answers the handle given back.

The device contexts `GetDC` gives out are USER's cache of a few, lent and given back. A handle given back is one of them still, so what is asked of it is answered.

[[measured]] [[probe:dcreuse]] asks which handle comes next for another place, records only whether two handles are the same, and found none given again for a place other than its own: a window's given back, the screen's is another handle; the screen's given back, another window's is another; two windows' given back in either order, the screen's is neither; a window's given back, a minimized window's is another, and that one's given back, the screen's another. Held at once, six of the screen's are five distinct handles: with the five all lent, Windows lends one of them again. Widget Workshop's installer, run under both engines, led here: the Rust engine let go of a different handle from the TypeScript engine's, through erasing a minimized window's title, which is now passed over in both as a window that paints itself is not.

[[measured]] [[probe:dcentry]] asks more of the same: a window's given back and asked for again is the same handle; five windows' in turn are five, a sixth window's the first's; with the five lent, the sixth of the screen's is the fifth, and so is a window's asked for then; a `CS_OWNDC` window's is the same each time and none of the five; a `CS_CLASSDC` class's two windows' are one. A common one lent again has a new context's attributes, `MM_TEXT` among them.

## Inside Windows

[[read out]] `USER.EXE` seg1 `a60b`: `GetDCEx` of the window with `DCX_USESTYLE` and the high word's 2, or of the desktop window with `DCX_WINDOW | DCX_CACHE` (`8406`-`8428`). Which of USER's entries it takes, and when its region is worked out, are [[fn:USER.GetDCEx]]'s and [[topic:visible-regions]]'s.

## Why it matters

Reversi asks `GetNearestColor` of a device context it has given back, and makes its board's brushes of the answer. winbox.js freed the handle, answered -1, and the board's grey came out white. The screen went from 53,676 pixels unlike Windows' to 19,349.

## In winbox.js

USER's entries as Windows keeps them (`crates/winbox-win16/src/dc_entries.rs`): five common contexts made at the start, each with its own surface and attributes, and one for each window of a `CS_OWNDC` class and each `CS_CLASSDC` class; the handles are fixed from the start, and given back they still answer. An entry still valid for the same window and flags is taken as it is, its region not worked out again. The window `LockWindowUpdate` locked gets a context of its own that draws where it does not show ([[fn:USER.LockWindowUpdate]]), not an entry.

A window's context comes with its visible region worked out by USER's rule, as `GetDCEx` with `DCX_USESTYLE` gives it: what shows of the client area, siblings above taken out where `WS_CLIPSIBLINGS` says, children where `WS_CLIPCHILDREN` does, cut to each parent and the screen, nothing for a hidden or minimized window or one within the window `LockWindowUpdate` locked ([[topic:visible-regions]]; [[probe:visrgn]], [[probe:visrule]]). `GetClipBox`, `RectVisible` and `PtVisible` answer by it.
