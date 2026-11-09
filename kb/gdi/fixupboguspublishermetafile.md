---
kind: function
module: GDI
name: FixUpBogusPublisherMetafile
ordinal: 464
summary: A memory metafile's size in its header checked against its records, and put right where asked -- as USER's clipboard does for a metafile picture.
versions:
  '3.1': exact
probes: [gdiint]
records: [fixup]
source: crates/winbox-win16/src/gdi/system_exports.rs
topics: [gdi-internals, metafiles]
---

## Observed behaviour

[[probe:gdiint]] makes a memory metafile, takes its bits, and changes its header.

- [[measured]] `FixUpBogusPublisherMetafile(lpMetaHeader, fFix)` answers 1 where the header's size, the long at 6, is the header's own words and every record's to the last.
- [[measured]] Where it is not, it answers nought, and with `fFix` writes the right size there; without, leaves it.
- [[measured]] A header whose type is not 1, a memory metafile, answers -2 and is left.

## Inside Windows

[[read out]] `GDI.EXE` seg19 `1862`. The type at nought must be 1. The header's size in words (+2) starts the sum, and passes the header within its segment (`1883`). Each record's size, a long, is added, and the pointer moves on by it in words through a huge pointer, `__AHINCR` selectors on for each 64 KiB (`18a3`-`18b5`); a record that crosses a segment's end is read in pieces (`18b7`-`18e1`). The record whose function is nought ends it. Then the sum against the long at 6 (`18e3`). `retf 6`.

## Nuances

- [[read out]] A record of no size whose function is not nought before the end would have the loop go round for ever; WinBox ends the walk there.

## Callers

[[read out]] `USER.EXE` imports it: its clipboard code, for an entry of format 3, `CF_METAFILEPICT`, locks the picture's metafile and puts it right, with `fFix` 1, and lets the entry go where the answer is -1 (seg39 `0549`-`05a0`); the answer is never -1.

## Implementation

As read out. [[probe:gdiint]] agrees in both.

**Recommendation:** done. WinBox's USER does not call it yet from its clipboard.
