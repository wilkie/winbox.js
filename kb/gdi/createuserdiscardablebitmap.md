---
kind: function
module: GDI
name: CreateUserDiscardableBitmap
ordinal: 409
summary: Makes a discardable bitmap compatible with a device context, for USER.
versions:
  '3.1': exact
probes: [gdimisc]
records: [userbitmap]
topics: [gdi-objects]
---

## Observed behaviour

- [[measured]] 20 by 10 on the VGA: four planes of one bit, width bytes 4, as `CreateCompatibleBitmap` makes it ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg4 `0200`: the body `CreateDiscardableBitmap` shares (seg4 `0209`), with CX 101h where its own entry passes 100h, which calls `CreateBitmap`'s body with the context's planes and bits (+86h, +87h).

## Implementation

In both engines as [[fn:GDI.CreateCompatibleBitmap]], as `CreateDiscardableBitmap` is answered. [[probe:gdimisc]] agrees in both.
