---
kind: function
module: GDI
name: IsGDIObject
ordinal: 462
summary: Answers what kind of GDI object a handle is — 1 a pen up to 7 a device context — or nought for anything else.
versions:
  '3.1': exact
probes: [queries]
source: src/win16/gdi/queries.ts
topics: [small-queries, gdi-objects]
---

## Observed behaviour

[[measured]] `IsGDIObject` answers the object's kind, not TRUE: 1 for a pen, 2 a brush, 3 a font, 4 a palette, 5 a bitmap, 6 a region, 7 a device context. A window's handle, nought and a pen already deleted are nought. [[probe:queries]] asks it of one of each, and winbox.js agrees with all ten records.
