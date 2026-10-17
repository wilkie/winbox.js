---
kind: function
module: LZEXPAND
name: LZDone
ordinal: 9
summary: The buffers LZStart made let go with the count's last.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

- [[measured]] Called once more than [[fn:LZEXPAND.LZStart]], nothing goes wrong, and [[fn:LZEXPAND.LZCopy]] after it makes its buffers again ([[probe:lzfiles]], `start`).

## Nuances

- [[read out]] No arguments, and no answer.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg4 `00a6`: a count of nought, nothing; else down by one, and at nought the buffers made current, freed (seg1 `00b2`) and the nought kept.

## Implementation

`lzDone` in `src/win16/lzexpand/lz.ts` and `lz_done` in `crates/winbox-win16/src/lzexpand/mod.rs`.
