---
kind: function
module: GDI
name: CreateUserBitmap
ordinal: 407
summary: Makes a bitmap for USER as CreateBitmap makes one.
versions:
  '3.1': exact
probes: [gdimisc]
records: [userbitmap]
topics: [gdi-objects]
---

## Observed behaviour

- [[measured]] 16 by 8, one plane of one bit: `GetObject` reads 14 bytes, width bytes 2 ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0ec1`: `CreateBitmap`'s own body (seg1 `0e02`), with CL 80h where `CreateBitmap`'s entry (`0e95`) passes nought -- a flag of the object made, not of what `GetObject` reads.

## Implementation

As [[fn:GDI.CreateBitmap]]. The flag is not kept. [[probe:gdimisc]] agrees in both.
