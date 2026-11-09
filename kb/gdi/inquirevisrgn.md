---
kind: function
module: GDI
name: InquireVisRgn
ordinal: 131
summary: Answers the handle of a device context's visible region itself, in the screen's terms.
versions:
  '3.1': exact
probes: [visfam]
records: [start, save]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] The same handle each time, through saves and narrowings, until [[fn:GDI.RestoreVisRgn]] ([[probe:visfam]], `start`, `save`).
- [[measured]] A window's context's is its client area in the screen's terms where nothing covers it; a new memory context's is empty, and with a 30 by 20 bitmap selected, (0, 0, 30, 20); the screen's the screen ([[probe:visrgn]]).

## Nuances

- The region is the context's own, not a copy: a program changing it changes what the context draws on in Windows. Not recorded.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `200a`: the context's hook called where its flag is set, then the word at A0h answered ([[topic:visible-regions]]).

## Implementation

In both engines (`crates/winbox-win16/src/gdi/visible_region.rs`): a region object the context keeps, given the visible region as it is each time it is asked; a program changing it changes nothing. [[probe:visfam]] agrees in both, and so do [[probe:visrgn]]'s and [[probe:visrule]]'s regions of windows covered, clipped, minimized or hidden, which USER works out by Windows' rule ([[topic:visible-regions]], phase 2).
