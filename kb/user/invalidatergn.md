---
kind: function
module: USER
name: InvalidateRgn
ordinal: 126
summary: Adds a region to what a window is due to paint, and to the windows in it where it has no WS_CLIPCHILDREN; ValidateRgn takes one away, GetUpdateRgn gives what is left, ExcludeUpdateRgn keeps a device context out of it, UpdateWindow paints a window and those in it, and BeginPaint's rectangle is its clip box.
versions:
  '3.1': exact
probes: [updrgn, invchild]
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

### The windows in it

[[probe:invchild]] invalidates a pop-up P without `WS_CLIPCHILDREN` with children K (with a child G of its own), D of a `CS_PARENTDC` class, and E reaching out of P; a pop-up Q with `WS_CLIPCHILDREN` and two such children; a hidden pop-up with a child; and paints them by [[fn:USER.UpdateWindow]] and by the message loop. [[measured]]

- [[fn:USER.InvalidateRect]] and `InvalidateRgn` of P make each window in it due where the rectangle or region meets it, however deep, and each is erased and sent `WM_NCPAINT` before its paint, though P was invalidated not to erase. Q's children are not made due.
- A window is given the region whole, not cut to itself: D, under (0, 0)-(130, 60) of P, has a clip box of (−100, −10, 30, 50) in its paint, and `rcPaint` (0, 0, 30, 40). [[fn:USER.GetUpdateRect]] and `GetUpdateRgn` cut what they give to the client area and to those of the windows it is in: E is due (0, 0, 30, 30), what of it shows in P.
- `ValidateRect` of P validates K and G too. Of a window whose frame is still due, all is its client area: D, given a region reaching out of it, is left due outside its client area, `GetUpdateRgn` answering nothing and `GetUpdateRect` (50, 0, 60, 40), and is painted after with a clip box of that region.
- `InvalidateRect` of a hidden window, or of a child of one, does nothing.
- `UpdateWindow` of P paints P, then the windows in it, each and its own in turn, front to back. A child validated, its frame still due, is sent `WM_NCPAINT` from P's `BeginPaint`.
- `BeginPaint`'s `rcPaint` is its context's clip box: K under a window over all of it gets (0, 0, 0, 0) and no `WM_ERASEBKGND`.

[[read out]] `InvalidateRect`, `InvalidateRgn`, `ValidateRect` and `ValidateRgn` are `RedrawWindow`'s body with `RDW_INVALIDATE`, `RDW_INVALIDATE | RDW_ERASE` or `RDW_VALIDATE` (`USER.EXE` seg1 `aa27`-`aabc`, `011c`-`0176`, `3e1e`). It does nothing where the window or one it is in is hidden or one it is in minimized (`3e4a`, `1c5f`); a rectangle is moved by the client area's corner into a region of the screen (`3e60`-`3ebb`), none being all of the window. `3ed7` cuts the window's client rectangle to those of the windows it is in (`8bb3`), tells the lock (`3f41`-`3f7c`) and walks: the window given the region, before the windows in it where it has no `WS_CLIPCHILDREN` and after where it has, and each window in it where it has no `WS_CLIPCHILDREN`, with `RDW_ERASE | RDW_FRAME` added (`4034`-`4176`, [[topic:visible-regions]]). Made valid, a window is given all or less (`4309`-`43e6`): all of a window whose frame is due is its client area (`4353`), and all it was due the whole window then (`4371`-`43a6`).

[[read out]] `UpdateWindow` (`a95d`, `4404`, `441d`, `444c`): a window with an update region or a paint of its own to come is sent `WM_PAINT`, or `WM_PAINTICON` minimized with its class's icon; then each window in it the same way, front to back. A window with `WS_EX_TRANSPARENT` that is due is passed over while a window behind it is (`4424`-`443e`, `44d8`-`4503`). Before a window with an update region is painted, each window it is in that is due, up to one with `WS_CLIPCHILDREN`, is validated where it is (`4515`, the walk with `RDW_VALIDATE | RDW_NOCHILDREN`).

[[read out]] `BeginPaint` (`75c8`): its `rcPaint` is `GetClipBox` of its context, cut to the client area for a class with `CS_PARENTDC` (`7687`, `78be`-`790e`); where that is empty the erase is not sent, and the window is not due one after (`762a`, `768c`). Before it answers, each window in it whose frame is due and that has no update region is sent `WM_NCPAINT` (`76a7`, `7b30`). `GetUpdateRect` and `GetUpdateRgn` cut to the client areas the window is in by the same `8bb3` (`46f2`, `47c2`).

Both engines agree with all 215 records.

## Implementation

`src/win16/user/update-region.ts`, through `redrawThrough` in `src/win16/user/invalidate-through.ts` (`InvalidateRect.ts`, `ValidateRect.ts`, `UpdateWindow.ts`, `BeginPaint.ts`); in Rust `user_calls/update_region.rs`, `invalidate_through.rs` and `paint.rs`. Not followed: a bit of the window's own at 26h that `3e35` and `1c5f` ask of a minimized window's class icon; `GetUpdateRect` answering 1 for an update region whose box is empty; [[fn:USER.InvalidateRect]] of no window, which repaints every window (`015d`-`0172`, 285h). The desktop still keeps a window's update as `dirtyRect`, its box, which everything else reads. The region beside it counts only while it is that box's: whatever sets `dirtyRect` another way falls back to the box, as before.
