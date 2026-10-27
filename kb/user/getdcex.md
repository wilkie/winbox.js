---
kind: function
module: USER
name: GetDCEx
ordinal: 359
summary: A device context of a window's, what it may draw in said by flags and a region.
versions:
  '3.1': partial
probes: [getdcex, visrgn, visrule, dcentry]
records: [dc, parentclip, region]
topics: [painting, clip-regions, visible-regions]
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
- [[measured]] [[probe:visrgn]] and [[probe:visrule]] hold each flag's region to the pixel, `InquireVisRgn`'s: `DCX_CLIPSIBLINGS` and `DCX_CLIPCHILDREN` taking out siblings above and children, `DCX_PARENTCLIP` given the parent's but where the parent has `WS_CLIPCHILDREN`, the flags have `DCX_CLIPSIBLINGS` or `DCX_CLIPCHILDREN` too, or the child is hidden and the parent not; `DCX_CACHE` alone keeps what lies over a window, even one at the top; `DCX_LOCKWINDOWUPDATE` gives the locked window and its children their regions. A region given that is not one -- 1 among them -- answers nought. See [[topic:visible-regions]].

- [[measured]] [[probe:dcentry]]: a parent's `DCX_WINDOW | DCX_CACHE | DCX_CLIPCHILDREN` context, given back, its child moved, and asked for again: the same context, its region still with the child where it was, until its hook works it out again.

## Nuances

- [[read out]] Nought with `DCX_INTERSECTRGN` leaves nothing to draw in (`USER.EXE` seg1 `8711`-`871d`); with `DCX_EXCLUDERGN`, nothing is taken out (`874e`). The body takes 1 for the whole screen (`86f0`, `876b`), but only USER's own callers can pass it: from a program it is no region, and answers nought. Where both flags are given, `DCX_INTERSECTRGN` wins (`86e7`).
- [[read out]] `DCX_USESTYLE` takes the clipping flags from the window's and its class's styles: `CS_PARENTDC` for `DCX_PARENTCLIP`, `WS_CLIPCHILDREN` and `WS_CLIPSIBLINGS` for theirs, `DCX_CACHE` unless the class has a context of its own (`8491`-`84fb`); for `DCX_WINDOW`, only `WS_CLIPSIBLINGS`.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `a64c`: the window checked, the region checked to be one (GDI 462 answering 6), the flags to have no bits but those known (`a676`), then the work at `847b`-`87b7`. Without `DCX_CACHE`, USER looks among its contexts for the window's own or its class's (`8560`-`85b3`), and answers nought where there is none (`85b6`). `DCX_KEEPCLIPRGN` is a bit of the context's kept (`8703`-`8709`).

## Implementation

`src/win16/user/get-dc-ex.ts` and `dc-entries.ts`; the Rust engine's `crates/winbox-win16/src/get_dc.rs` and `dc_entries.rs`. One of USER's entries is taken as seg1 `847b`-`87b7` takes it ([[topic:visible-regions]]): the window's own or its class's, or a common one -- one still valid for the same window and flags taken as it is, else the first emptied or the last free, else the one taken last given back and taken again. A region worked out is USER's rule's for the flags (`visible-region-rule.ts`, `window_vis.rs`), the region given intersected or taken out in the screen's terms; `ReleaseDC` deletes it and restores the region before it. Both engines agree with [[probe:getdcex]], [[probe:visrgn]] and [[probe:visrule]] in every record. `DCX_PARENTCLIP` and `CS_PARENTDC` draw where Windows draws, over the parent's client area outside the child: the context is a view of the whole screen from the child's corner, drawn through its region alone (phase 3 of [[topic:visible-regions]]); [[probe:visdraw]] agrees in both, each way of drawing. Not done: the warning for unknown flags, the bounds kept as an entry is taken (seg1 `06ff`), and the font for a program made before Windows 3.0 (`87be`).
