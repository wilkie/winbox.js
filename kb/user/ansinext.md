---
kind: function
module: USER
name: AnsiNext
ordinal: 472
summary: Steps a pointer forward over one character of a string, staying put at the terminator.
versions:
  '3.1': exact
probes: [strings]
---

## Observed behaviour

- [[documented]] It exists so that code walking a string need not know how many bytes a character takes, which on a double-byte character set can be two.
- [[measured]] 3 of 3 recorded steps agree. See [[probe:strings]].
- [[measured]] From the start of `"a"` and of `"hello"` it moves one byte.
- [[measured]] From the terminator of `""` it moves zero bytes: it returns the pointer it was given, so a loop built on it stops at the end rather than running past it.

## Nuances

- [[measured]] Every recorded step starts at the beginning of the string; the offset from there is recorded, not the pointer.
- Not yet measured: a double-byte character set, and a NULL pointer.

## Implementation

Returns the same pointer when it points at a zero byte, and the next offset in the same segment otherwise. See [[fn:USER.AnsiPrev]].
