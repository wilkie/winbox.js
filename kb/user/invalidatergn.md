---
kind: function
module: USER
name: InvalidateRgn
ordinal: 126
summary: Adds a region to what a window is due to paint; ValidateRgn takes one away, GetUpdateRgn gives what is left, and ExcludeUpdateRgn keeps a device context out of it.
versions:
  '3.1': exact
probes: [updrgn]
source: src/win16/user/update-region.ts
topics: [painting]
---

## Observed behaviour

[[probe:updrgn]] invalidates and validates parts of a window 64 by 48, and asks what it is due to paint. [[measured]]

- **A region, not a box.** Two rectangles invalidated apart, (0, 0)-(10, 10) and (40, 30)-(60, 40), are a complex region. [[fn:USER.GetUpdateRect]] answers its box, and a point between them is not in what [[fn:USER.GetUpdateRgn]] gives.
- **The paint is clipped to it.** `BeginPaint`'s `rcPaint` is the box, but a paint that fills the whole client area black leaves the gap between the two rectangles white.
- **ValidateRgn** cuts a region out: (10, 10)-(30, 20) less (10, 10)-(20, 20) leaves (20, 10)-(30, 20). With NULL, nothing is left. `InvalidateRgn` of NULL is the whole client area.
- **GetUpdateRgn** answers the kind of what it gives: 1 for nothing, 2 for a rectangle, 3 for more.
- **ExcludeUpdateRgn** cuts what the window is due to paint out of a device context's clip, and answers what is left's kind, 3 with a hole in it. [[fn:GDI.PtVisible]] is then nought inside the hole and 1 outside.

winbox.js agrees with all 7 records. All four were stubs. [[fn:USER.InvalidateRect]] and [[fn:USER.ValidateRect]] now add and cut rectangles the same way. `ValidateRect` had validated the whole window whatever rectangle it was given. `PtVisible` and `RectVisible` had not looked at the clip region.

## Implementation

`src/win16/user/update-region.ts`. The desktop still keeps a window's update as `dirtyRect`, its box, which everything else reads. The region beside it counts only while it is that box's: whatever sets `dirtyRect` another way falls back to the box, as before.
