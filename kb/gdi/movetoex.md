---
kind: function
module: GDI
name: MoveToEx
ordinal: 483
summary: MoveTo answering in a POINT; with the other Ex forms of the mapping and position functions.
versions:
  '3.1': exact
probes: [brushind, exfuncs]
source: src/win16/gdi/MoveTo.ts
topics: [mapping-modes, line-drawing]
---

## Observed behaviour

- [[measured]] `MoveToEx` answers 1 and puts the previous position in the `POINT` it is given. With no `POINT` it puts nothing. With no device context it answers nought and leaves the `POINT` alone ([[probe:brushind]]).

[[probe:exfuncs]] calls the Ex form of each mapping function, [[fn:GDI.GetCurrentPosition]] and [[fn:GDI.GetBrushOrg]] on a memory device context in `MM_ANISOTROPIC`, then in `MM_TEXT`. Each fills a `POINT` or `SIZE` that starts as -1,-1.

- [[measured]] Each is its plain form, answering `BOOL`, with the point or size the plain form answers put in the structure.
- [[measured]] A form that asks (`GetViewportOrgEx`, `GetWindowExtEx`, `GetCurrentPositionEx`, `GetBrushOrgEx` and the rest) answers 1, even with no device context. Then it puts 0,0.
- [[measured]] A form that sets (`SetViewportOrgEx`, `OffsetWindowOrgEx`, `ScaleViewportExtEx` and the rest) answers 1 and puts the value as it was before. With no device context it answers nought and puts nothing.
- [[measured]] In `MM_TEXT`, setting an extent changes nothing but still answers 1, with the extent that stays.
- [[measured]] With no structure, nothing is put and the answer is the same.

winbox.js agrees with all 35 records.

## Nuances

- Not recorded, and not followed: `GetBitmapDimensionEx`, `SetBitmapDimensionEx` and `GetAspectRatioFilterEx`, whose plain forms winbox.js does not have.
