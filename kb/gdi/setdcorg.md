---
kind: function
module: GDI
name: SetDCOrg
ordinal: 117
summary: Sets where a device context's (0, 0) is on the screen, moving its clip region with it but not its visible region; answers the old origin.
versions:
  '3.1': partial
probes: [visfam]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] On a window's context at (100, 100), `SetDCOrg(10, 20)` answers 100, 100 (x in the low word); [[fn:GDI.GetDCOrg]] then answers 10, 20, the visible region stays at (100, 100, 300, 200), and the clip box is (90, 80, 290, 180). Drawing lands from the new origin, within the visible region ([[probe:visfam]], `origin`).
- [[measured]] The clip region moves with the origin: [[fn:GDI.GetClipRgn]]'s (100, 100, 120, 120) is (130, 110, 150, 130) after `SetDCOrg(130, 110)` (`cliprgn`).
- [[measured]] The origin outlives [[fn:USER.ReleaseDC]]: got again, the context is still at (150, 120) until USER's hook makes it again.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `1118`: the origin at A2h and A4h exchanged, the viewport's at 70h and 72h made again from it, and where it moved and there is a clip region, the clip region moved by the difference (`296c`) and the region drawing goes through made again; the visible region at A0h is not touched. USER sets it as it hands a context out ([[topic:visible-regions]]).

## Implementation

In WinBox, (`crates/winbox-win16/src/gdi/visible_region.rs`): the origin kept, the clip region -- kept in the context's own terms -- left as it is, which is Windows' moving it in the screen's; [[fn:GDI.GetDCOrg]], [[fn:GDI.GetClipBox]] and [[fn:GDI.GetClipRgn]] answer from it. [[fn:GDI.SaveDC]] and [[fn:GDI.GetDCState]] save it. A window's context is a view of the whole screen from its origin, so drawing moves with it, left of and above the window too ([[probe:visfam]]'s `origin` and `cliprgn`, [[probe:visdraw]]'s `origin`: `PatBlt`, `TextOut`, `LineTo` and `BitBlt`); a brush is aligned from it. [[fn:USER.GetDC]] still sets the origin back (phase 4 of [[topic:visible-regions]]), so `origin`'s `got again` differs. A memory context's drawing does not move with its origin: its pixels are its bitmap's, from nought. Not recorded.
