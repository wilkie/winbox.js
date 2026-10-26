---
kind: function
module: GDI
name: GetPhysicalFontHandle
ordinal: 352
summary: Answers the handle of the font GDI realized for a device context -- its physical font, not the logical font selected.
versions:
  '3.1': stub
probes: [gdimisc]
topics: [small-queries]
---

## Observed behaviour

- [[measured]] A new memory device context answers a handle; once Arial is selected and drawn with, another ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0a2e`: no handle is checked; the word at +28h of the device context, the realized font's handle, which realizing a font for the context sets.

## Implementation

A stub in both engines: WinBox realizes fonts without a realized-font object of GDI's local heap for a context to name, so there is no handle to answer. [[probe:gdimisc]] records it as a known gap.

## Not yet done

- A realized font's handle, kept as the context realizes one.
