---
kind: function
module: GDI
name: LineDDA
ordinal: 100
summary: Calls a program's procedure with each point of a line but its last, stepping along the longer axis and rounding the other.
versions:
  '3.1': exact
probes: [gdidraw]
source: src/win16/gdi/gdi-draw.ts
topics: [line-drawing]
---

## Observed behaviour

[[probe:gdidraw]] has its procedure write down every point it is given. [[measured]]

- Every point but the last, from the first: (0, 0) to (10, 4) gives ten points, from (0, 0) to (9, 4).
- One step at a time along the longer axis, the other rounded to the nearest: (0, 0), (1, 0), (2, 1), (3, 1), (4, 2), (5, 2), (6, 2), (7, 3), (8, 3), (9, 4).
- The same line the other way gives the same pixels from the other end, less its first: (10, 4) down to (1, 0).
- A line of one point gives nothing.

winbox.js agrees with all five lines. It was a stub. Which way a half rounds is not recorded: none of the lines had one.
