---
kind: function
module: USER
name: AnsiPrev
ordinal: 473
summary: Steps a pointer back over one character of a string, given where the string starts, staying put at the start.
versions:
  '3.1': exact
probes: [strings]
---

## Observed behaviour

- [[documented]] The start of the string is passed as well, because on a double-byte character set a byte alone cannot say whether it is a whole character or the second half of one.
- [[measured]] 3 of 3 recorded steps agree. See [[probe:strings]].
- [[measured]] From the terminator of `"a"` it moves back to offset 0, and from the terminator of `"hello"` to offset 4.
- [[measured]] At the start of `""`, where start and current are the same, it returns the start.

## Nuances

- [[measured]] Every recorded step starts at the terminator; the offset from the start is recorded, not the pointer.
- Not yet measured: a double-byte character set, a current pointer before the start, and pointers in different segments.

## Implementation

Returns the start when the current offset is not past it, and one byte back otherwise, in the start's segment. See [[fn:USER.AnsiNext]].
