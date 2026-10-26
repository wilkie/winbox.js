---
kind: function
module: USER
name: GetDCEx
ordinal: 359
summary: A device context of a window's, what it may draw in said by flags and a region.
versions:
  '3.1': partial
probes: [getdcex]
records: [dc, parentclip, region]
topics: [painting, clip-regions]
source: src/win16/user/get-dc-ex.ts
---

## Observed behaviour

- [[measured]] [[probe:getdcex]], on an overlapped window with a child in it:
  - No window, nought.
  - Without `DCX_CACHE`, for a window whose class has no context of its own, nought -- with `DCX_WINDOW` too.
  - `DCX_CACHE`: the client area's, its origin and clip box what [[fn:USER.GetDC]] gives. With `DCX_WINDOW`, the whole window's, as `GetWindowDC` gives.
  - `DCX_CLIPCHILDREN`: the clip box the client area still, but a complex region, the child left out.
  - `DCX_PARENTCLIP` on the child: its own origin, and the parent's client area to draw in, a box from -10,-10 past the child's own.
  - `DCX_INTERSECTRGN` with a region in the screen's terms: only where the region and the client area meet. `DCX_EXCLUDERGN`: the client area less it, a complex region.
  - The region given with either is deleted as the context is released; with `DCX_KEEPCLIPRGN` too, it is not. Given with neither, it is not looked at, and stays.

## Nuances

- [[read out]] Nought with `DCX_INTERSECTRGN` leaves nothing to draw in (`USER.EXE` seg1 `8711`-`871d`); 1 is no region (`86f0`). Where both flags are given, `DCX_INTERSECTRGN` wins (`86e7`).
- [[read out]] `DCX_USESTYLE` takes the clipping flags from the window's and its class's styles: `CS_PARENTDC` for `DCX_PARENTCLIP`, `WS_CLIPCHILDREN` and `WS_CLIPSIBLINGS` for theirs, `DCX_CACHE` unless the class has a context of its own (`8491`-`84fb`).

## Inside Windows

- [[read out]] `USER.EXE` seg1 `a64c`: the window checked, the region checked to be one (GDI 462 answering 6), the flags to have no bits but those known (`a676`), then the work at `847b`-`87b7`. Without `DCX_CACHE`, USER looks among its contexts for the window's own or its class's (`8560`-`85b3`), and answers nought where there is none (`85b6`). `DCX_KEEPCLIPRGN` is a bit of the context's kept (`8703`-`8709`).

## Implementation

`src/win16/user/get-dc-ex.ts`; the Rust engine's `crates/winbox-win16/src/get_dc.rs`. The context is `GetDC`'s or `GetWindowDC`'s, its clip region narrowed by the flags; the region is deleted by `ReleaseDC`. Windows keeps what the flags take away in the context's visible region, apart from its clip region: a program's `SelectClipRgn` after takes it away here. Not done: `DCX_PARENTCLIP` -- a window's context draws in its own client area only ([[probe:getdcex]]'s `parentclip` is a known gap) -- and `DCX_USESTYLE`.
