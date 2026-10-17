---
kind: function
module: LZEXPAND
name: GetExpandedName
ordinal: 10
summary: The name a compressed file had -- the underscore its extension ends with made the header's letter, in the case of the path's first letter, a lone period dropped -- or a plain file's name as it is.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] asks for the expanded names of its files into a buffer holding `untouched`.

- [[measured]] `C:\ORACLE\LZ\TEXT.TX_`, its header's letter `T`, is `TEXT.TXT`; in lower case, `text.txt`. `LOW.TX_`, whose letter is `t`, is `LOW.TXT` and `low.txt`: the case is the path's first letter's.
- [[measured]] `ODD.X_` with `y` is `ODD.XY`; `DIGIT.TX_` with `1` is `DIGIT.TX1`; `NOEXT._` with nought is `NOEXT`.
- [[measured]] A plain file, a wrong signature, a file shorter than a header: the name as it was given.
- [[measured]] A file not there, a folder not there, a drive `1:`: -1, the buffer untouched.

## Nuances

- [[read out]] The arguments: far pointers to the name and the buffer; it pops 8 bytes and answers an `INT`: 1, or -1.
- [[read out]] Only an ASCII letter in the header changes case; the path's first ASCII letter decides, a drive's letter with it, by USER's `IsCharLower` and `IsCharUpper`.
- [[read out]] A file of 14 bytes or more whose header cannot be read is -1, and left open.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `01bc`: `OpenFile` to read; -1 where it fails; the header (seg8 `00aa`); `_lclose`; the name copied; COMPRESS's header: the name fixed (entry 14, seg10 `01b6`).

## Implementation

`getExpandedName` in `src/win16/lzexpand/lz.ts` and `get_expanded_name` in `crates/winbox-win16/src/lzexpand/mod.rs`. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it.
