---
kind: function
module: GDI
name: SaveVisRgn
ordinal: 129
summary: Pushes a copy of a device context's visible region on its stack, and answers the copy that was on top before.
versions:
  '3.1': exact
probes: [visfam]
records: [save]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] The first on a context answers nought, the second a handle; [[fn:GDI.InquireVisRgn]] answers the same handle as before them ([[probe:visfam]], `save`).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `076c`: a copy of the region at A0h made (`18ce`), and linked in through the region's own first word: the copy takes the old head, the region the copy. The old head is the answer. [[fn:GDI.RestoreVisRgn]] takes them back the other way. USER saves the region before it narrows it for `GetDCEx`'s `DCX_INTERSECTRGN` and `DCX_EXCLUDERGN` and for menus ([[topic:visible-regions]]).

## Implementation

In both engines (`crates/winbox-win16/src/gdi/visible_region.rs`): each copy a region object with a handle of GDI's, kept on the context's stack. [[probe:visfam]]'s `save` agrees in both.
