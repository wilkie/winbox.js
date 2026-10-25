---
kind: function
module: GDI
name: WEP
ordinal: 59
summary: GDI's library exit; answers 1.
versions:
  '3.1': exact
probes: [gdimisc]
records: [wep]
topics: [small-queries]
---

## Observed behaviour

- [[measured]] 1 ([[probe:gdimisc]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `1ec0`: `mov ax,1` and `retf 2`.

## Implementation

In both engines as read out. [[probe:gdimisc]] agrees in both.
