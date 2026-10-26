---
kind: function
module: GDI
name: ExcludeVisRect
ordinal: 73
summary: Takes a rectangle given in the screen's terms out of a device context's visible region, and answers the kind drawing is kept to.
versions:
  '3.1': exact
probes: [visfam]
records: [exclude]
source: src/win16/gdi/visible-region.ts
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] (150, 120, 250, 170) out of a window's context's client area at (100, 100, 300, 200) answers 3; the clip box stays the client area, and drawing leaves the hole ([[probe:visfam]], `exclude`).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `16a5`, one body with [[fn:GDI.ExcludeClipRect]] (`16b9`), changing the field at A0h; the rectangle in the screen's terms, not mapped ([[topic:visible-regions]]).

## Implementation

In both engines (`src/win16/gdi/visible-region.ts`, `crates/winbox-win16/src/gdi/visible_region.rs`): the rectangle as given taken out of the visible region, the kind of the clip region within it answered. [[probe:visfam]]'s `exclude` agrees in both.
