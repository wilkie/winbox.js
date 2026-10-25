---
kind: function
module: GDI
name: GetFontData
ordinal: 311
summary: Copies bytes of the selected TrueType font's file — a table, or the whole file — or answers how many there are.
versions:
  '3.1': partial
probes: [ttquery, ttqmap]
topics: [truetype-queries]
---

## Observed behaviour

- [[measured]] A table of nought is the whole file: Arial's 65,692 bytes, and its first sixteen are the file's ([[probe:ttquery]]).
- [[measured]] With no buffer it answers how many bytes there are from the offset to the table's end, whatever size is given: `head` is 36h bytes, and from 10 with a size of 4 it answers 2Ch.
- [[measured]] With a buffer it copies what is left of the table past the offset, cut to the size, and answers how many: 40 bytes asked of `head` from 40 copy 14 and answer 0Eh.
- [[measured]] An offset at or past the table's end answers -1, and so does a table the file lacks: Courier New has no `kern`.
- [[measured]] With a buffer and a size of nought it copies nothing and answers nought.
- [[measured]] A strike, the System font, answers -1, and so does a device context of nought.

## Inside Windows

[[read out]] `GDI.EXE` seg7 `07fc` checks the device context and the buffer, then seg7 `0d98` asks the TrueType engine where the font selected is a TrueType one and TrueType is on, -1 otherwise. The engine's reading is seg40 `0113`, reached through seg36 `005a`:

- With no buffer the size is taken as FFFFFFFFh.
- A table of nought takes the file's size. Otherwise the table directory is searched for the tag, its four bytes as the dword's; not found is -1.
- What is left, the table's length less the offset, is compared signed: nought or less is -1. It is cut to the size, compared unsigned.
- With no buffer that is the answer. Otherwise the file is opened, the table's offset plus the given one sought, and that many bytes read, at most FFFFh at a time; a short read answers -1.

## Implementation

As read out, in both engines, from the font file's bytes the face was loaded from ([[topic:truetype-queries]]). [[probe:ttquery]] agrees in both.
