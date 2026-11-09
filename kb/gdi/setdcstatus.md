---
kind: function
module: GDI
name: SetDCStatus
ordinal: 170
summary: Sets or clears a device context's Windows' bounds, and answers whether they were set.
versions:
  '3.1': exact
probes: [bounds]
topics: [drawing-bounds]
---

## Observed behaviour

- [[measured]] It answers 1 where they were set and nought where not ([[probe:bounds]]).
- [[measured]] With a word of nought they are cleared and emptied; with one not nought they are set, to the rectangle given.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `439b`: -1 for a handle of nought. The set flag cleared; with the word not nought set again and the rectangle copied where one is given; with nought the rectangle emptied.

## Implementation

As read out. [[probe:bounds]] agrees in both.
