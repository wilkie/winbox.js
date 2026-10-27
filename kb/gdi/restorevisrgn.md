---
kind: function
module: GDI
name: RestoreVisRgn
ordinal: 130
summary: Makes the copy on top of a device context's stack its visible region, deleting the region it had, and answers the region's kind; −1 with none saved.
versions:
  '3.1': exact
probes: [visfam]
records: [save]
source: src/win16/gdi/visible-region.ts
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] After two saves and two narrowings, each restore answers 2 and brings back the region saved; [[fn:GDI.InquireVisRgn]] then answers another handle than before ([[probe:visfam]], `save`).
- [[measured]] With nothing saved it answers −1 and changes nothing.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `07b2`: the stack's head read from the region at A0h's first word; with none, −1 (`07e3`-`07e9`). Otherwise the copy becomes the region at A0h, the old region is deleted (`0805`), the saved levels are marked (`0808`), the region drawing goes through is made again (`080e`), and **the visible region's** kind is answered (`0811`), not the clipped one's ([[topic:visible-regions]]).

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): the copy's handle becomes the one [[fn:GDI.InquireVisRgn]] answers, and the old one is let go. [[probe:visfam]]'s `save` agrees in both.
