---
kind: function
module: GDI
name: SelectBitmap
ordinal: 195
summary: Selects a bitmap into a memory device context, or with nought the stock bitmap; answers the bitmap before.
versions:
  '3.1': exact
probes: [gdimisc]
records: [selectbitmap]
topics: [gdi-objects]
---

## Observed behaviour

- [[measured]] Another bitmap answers the one selected before; nought answers that other, and the bitmap then selected with `SelectObject` answers the stock bitmap ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `1ac6`: nought becomes GDI's word 15Bh, the stock bitmap, and the call goes on in `SelectObject`'s own selecting of a bitmap (`1be2`).

## Implementation

In both engines through `SelectObject`. WinBox makes its stock bitmap's handle the first time a memory context's first bitmap is replaced; nought before then answers nought. [[probe:gdimisc]] agrees in both.
