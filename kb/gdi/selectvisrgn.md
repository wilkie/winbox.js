---
kind: function
module: GDI
name: SelectVisRgn
ordinal: 105
summary: Makes a copy of a region a device context's visible region, in the screen's terms, and answers the kind drawing is kept to.
versions:
  '3.1': partial
probes: [visfam]
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] `SelectVisRgn` of (60, 70, 160, 130) on a window's context at (100, 100) answers 2; the clip box is then (-40, -30, 60, 30) -- the region in the screen's terms, moved by the origin, reaching out of the client area -- and drawing lands only within it ([[probe:visfam]], `select`).
- [[measured]] The region given stays the program's: changed after with `SetRectRgn`, the context's is not; and [[fn:GDI.InquireVisRgn]] answers another handle than the one given.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `1635`: the context's hook called where its flag is set; the region's bytes copied into the context's own visible region at A0h (`58b3`), its first word -- the stack [[fn:GDI.SaveVisRgn]] keeps -- kept; every saved level marked (`081d`); the region drawing goes through, at 1Eh, made again (`17b1`), whose kind is the answer (`1892`). See [[topic:visible-regions]].

## Implementation

In WinBox, (`crates/winbox-win16/src/gdi/visible_region.rs`), the region's shape kept as the context's visible region, and the kind of the clip region within it answered; nought for no context or no region. A window's context is a view of the whole screen from its origin and draws through its region alone: where the region reaches outside the window, it draws there, as Windows does ([[probe:visfam]]'s `select`).
