---
kind: function
module: USER
name: ReleaseDC
ordinal: 68
summary: Gives a device context back to USER's entries; a common one's attributes go back to a new context's, its visible region and origin staying.
versions:
  '3.1': exact
probes: [dcentry, dcreuse, reldc, dcreset, visfam]
source: src/win16/user/ReleaseDC.ts
topics: [visible-regions]
---

## Observed behaviour

- [[measured]] It answers 1 for a context lent and not yet given back; the same handle given back again answers nought ([[probe:dcentry]], `held`). A window's own context, `CS_OWNDC`, answers 1 each time, and so does a class's ([[probe:dcentry]], `own`).
- [[measured]] A common context given back still answers: [[fn:GDI.GetNearestColor]] and [[fn:GDI.GetDeviceCaps]] of it answer as before ([[probe:reldc]]).
- [[measured]] A common context lent again has a new context's attributes: the System font, black text on white, opaque, `R2_COPYPEN`, the black pen and the white brush ([[probe:dcreset]]), `MM_TEXT` ([[probe:dcentry]], `reset`). A window's own keeps what was set in it.
- [[measured]] What a program did to the visible region and the origin stays: `SelectVisRgn` and `SetDCOrg` made before it are there when the same window gets the same context again ([[probe:visfam]], `again`, `origin`).

## Nuances

- [[read out]] The window is not asked: the entry is found by its context alone (`USER.EXE` seg1 `8805`-`881c`). The export checks only that the window is one or nought and the context a context (`a61f`-`a641`).
- [[read out]] A region given to [[fn:USER.GetDCEx]] is let go -- `RestoreVisRgn`, the region deleted unless `DCX_KEEPCLIPRGN` -- for a common context; for a window's own or a class's only where `EndPaint` gives it back (`8827`-`883b`, seg1 `76cc`-`76d4`).

## Inside Windows

[[read out]] `USER.EXE` seg1 `8805`: the entry whose context it is, in use and not emptied (`881e`-`8825`), else nought; the region given let go as above (seg1 `885f`); a common entry's state set back with `SetDCState` from the copy USER kept as it made the first contexts (seg3 `0665`), and the entry no longer in use (`883e`-`884e`). `SetDCState` keeps the visible region and sets the origin back to what it was (`GDI.EXE` seg1 `072f`-`073f`). See [[topic:visible-regions]].

## Implementation

`src/win16/user/ReleaseDC.ts` and `dc-entries.ts`; the Rust engine's `crates/winbox-win16/src/get_dc.rs` and `dc_entries.rs`. As read out, in both. The context `GetDC` gives the window `LockWindowUpdate` locked is one of WinBox's own, not an entry, and is let go here ([[topic:visible-regions]], phase 5). The palette selected goes back to the stock one, as `SetDCState` sets it (`GDI.EXE` seg1 `074f`-`075e`); what Windows does then for the stock palette (seg22 `1088`) is not followed.
