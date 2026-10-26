---
kind: function
module: GDI
name: SetDCState
ordinal: 180
summary: Puts a state GetDCState copied back into a device context, keeping its visible region.
versions:
  '3.1': exact
probes: [visfam]
records: [state]
source: src/win16/gdi/visible-region.ts
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] The text colour set before [[fn:GDI.GetDCState]] comes back; [[fn:GDI.IntersectVisRect]] made between still holds: the visible region and clip box stay (100, 100, 130, 130) ([[probe:visfam]], `state`).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0615`: the state copied back, the origin set through [[fn:GDI.SetDCOrg]] where it differs, the visible region kept. [[fn:USER.ReleaseDC]] gives a common context back this way ([[topic:visible-regions]]).

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): the state put back as [[fn:GDI.RestoreDC]] puts one, the origin with it, the visible region left. [[probe:visfam]]'s `state` agrees in both.
