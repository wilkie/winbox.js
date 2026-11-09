---
kind: function
module: USER
name: GetInternalIconHeader
ordinal: 372
summary: An icon's or cursor's twelve bytes of header copied out.
versions:
  '3.1': exact
probes: [usermore]
records: [iconheader]
topics: [cursor]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermore]]: of a cursor [[fn:USER.CreateCursor]] made 32 square with its hotspot at (7, 9), locked, the hotspot, the width and height, four bytes a row, one plane and one bit a pixel -- twelve bytes, and the buffer's next four left as they were.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `1789`: the twelve bytes copied from where the icon is locked to the buffer (seg12 `023f`).

## Implementation

`crates/winbox-win16/src/small_calls.rs`.
