---
kind: function
module: GDI
name: GetDCState
ordinal: 179
summary: Answers a copy of a device context's state as SaveDC saves it, as a context of its own, without the visible region.
versions:
  '3.1': exact
probes: [visfam]
records: [state]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] It answers a handle; [[fn:GDI.SetDCState]] with it puts the text colour back, and a visible region narrowed between stays narrowed ([[probe:visfam]], `state`).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0601`: a copy made as [[fn:GDI.SaveDC]] makes one (`0a46`): the context's first A0h bytes, the origin and the clip region -- the visible region at A0h is not in it. USER keeps one for each common context it makes (`USER.EXE` seg3 `0665`) to give the context back as it was ([[topic:visible-regions]]).

## Implementation

In WinBox, (`crates/winbox-win16/src/gdi/visible_region.rs`): a new context, its state the state `SaveDC` saves (the origin with it), its handle GDI's. [[probe:visfam]]'s `state` agrees in both.
