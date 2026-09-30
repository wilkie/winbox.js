---
kind: function
module: GDI
name: SetBkColor
ordinal: 1
summary: Sets a device context's background colour, and answers the one before exactly as it was given — a colour the display has not, or a palette's, as well.
versions:
  '3.1': exact
probes: [bkcolor]
source: src/win16/gdi/SetBkColor.ts
topics: [standard-controls]
---

## Observed behaviour

[[measured]] [[probe:bkcolor]] sets the background and text colours of a screen device context one after another, and records each answer.

- A new device context's background is white, FFFFFFh, and its text black.
- Each call answers the colour before exactly as it was given. That includes 123456h, which the display has to dither, and 02000080h, which is relative to a palette. [[fn:GDI.SetTextColor]] answers the same way.
- [[fn:GDI.GetBkColor]] and [[fn:GDI.GetTextColor]] then answer white and black again.

winbox.js had answered the colour before in its own form, -1 for white. It agrees with all 10 records now.
