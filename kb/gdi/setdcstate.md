---
kind: function
module: GDI
name: SetDCState
ordinal: 180
summary: Puts a state GetDCState copied back into a device context, keeping its visible region and its origin.
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

[[read out]] `GDI.EXE` seg1 `0615`: the context's hook called first where its flag is set (`067f`); the state copied back, the visible region kept; the origin copied with the rest, then, where it differs from what the context had, exchanged back and [[fn:GDI.SetDCOrg]] called with the old one (`071d`-`073f`) -- so the context keeps its origin, and the clip region copied is moved into its terms. [[fn:USER.ReleaseDC]] gives a common context back this way ([[topic:visible-regions]]); [[measured]] an origin a program set outlives it ([[probe:visfam]], `origin`). The palette is in the state too (`074f`-`075e`).

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): the state put back as [[fn:GDI.RestoreDC]] puts one, the origin and the visible region left as they were; the clip region is kept in the context's own terms, so it needs no moving. WinBox's state holds no palette: a program's `SetDCState` leaves it as it was; USER's, as `ReleaseDC` gives a common context back, sets the stock one. [[probe:visfam]] agrees in both.
