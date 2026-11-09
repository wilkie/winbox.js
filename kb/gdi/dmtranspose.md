---
kind: function
module: GDI
name: DMTranspose
ordinal: 220
summary: Eight rows of a monochrome bitmap turned into columns -- a byte across becomes eight bytes down -- for a printer's driver that prints columns.
versions:
  '3.1': exact
probes: [gdidm]
records: [transpose]
source: crates/winbox-win16/src/gdi/driver_helpers.rs
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

[[probe:gdidm]] turns two rows of bytes a stride apart into columns, at strides of 2, -2, 1, 0 and 3.

- [[measured]] `DMTranspose(lpSrc, lpDst, nStride)` writes eight bytes for each byte across: for the stride's bytes, taken without its sign, the eight bytes down a column a stride apart are read, and the first byte written has bit 7 from the first row's leftmost bit through bit 0 from the eighth row's, the next the second bit, and so on.
- [[measured]] A stride below nought reads from the eighth row up: the rows are taken bottom first. A stride of nought turns one column of the same byte eight times.
- [[measured]] Nothing past the written bytes is touched; nothing is answered.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `024d`: the stride's sign and size (`0260`-`0268`), the start moved seven rows on for a negative stride (`0272`-`027c`), eight bytes loaded into registers (`0293`-`02b3`) and shifted out a bit of each at a time into each byte written (`02be`-`02dc`), then on to the next column (`0281`-`028a`); `retf 0Ah`.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`). It suits a dot-matrix printer's driver, whose head prints eight dots down.

## Implementation

As read out. [[probe:gdidm]] agrees in both.

**Recommendation:** done.
