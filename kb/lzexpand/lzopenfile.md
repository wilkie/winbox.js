---
kind: function
module: LZEXPAND
name: LZOpenFile
ordinal: 2
summary: A file opened with OpenFile -- its compressed name tried where it is not there -- and, opened only to be read, given to LZInit — an LZ handle for a compressed file, a DOS handle for another.
versions:
  '3.1': exact
probes: [lzfiles]
source: src/win16/lzexpand/lz.ts
topics: [compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] opens its files by their own names and their expanded ones, in several styles, and records the answer and the `OFSTRUCT`'s length, error and path.

- [[measured]] `TEXT.TX_` and `TEXT.TXT` (only `TEXT.TX_` is there) give LZ handles, the path `TEXT.TX_`'s; so do `OF_SHARE_DENY_NONE` and `OF_SHARE_DENY_WRITE`.
- [[measured]] `OF_EXIST`, `OF_READWRITE`, `OF_CREATE`, `OF_DELETE` and `OF_PARSE` are answered as `OpenFile` answers them, without `LZInit`: a DOS handle, or nought for `OF_PARSE`.
- [[measured]] A plain file, a file shorter than a header, an empty file and a wrong signature: their DOS handles.
- [[measured]] Another algorithm: -8, the file closed.
- [[measured]] `PLAIN.TX`, not there: -1, the `OFSTRUCT`'s error 2 and its path `PLAIN.TX_`, the compressed name tried last. A folder not there: -1, error 3, its path the name given -- only error 2 tries the compressed name.
- [[measured]] `NOEXT` finds `NOEXT._`; `DIGIT.TXX` finds `DIGIT.TX_`.

## Nuances

- [[read out]] The arguments: far pointers to the name and the `OFSTRUCT`, and the style; it pops 10 bytes and answers an `INT`.
- [[read out]] The name is copied into LZEXPAND's own 128 bytes (`[1E0h]`) first.
- [[read out]] The compressed name (entry 13, seg10 `0124`): the extension's last character made `_`; `_` added to an extension of fewer than three; `._` added to a name with none.
- [[read out]] `LZInit` is called where the style has no bits but the sharing mode's (`style & FF0Fh` nought); its error closes the file.

## Inside Windows

[[read out]] `LZEXPAND.DLL` seg2 `0262`: `lstrcpy` into `[1E0h]`; `OpenFile`; -1 with the structure's error 2, the name made the compressed one and `OpenFile` again; then [[fn:LZEXPAND.LZInit]] as above, `_lclose` on its error.

## Implementation

`lzOpenFile` in `src/win16/lzexpand/lz.ts` and `lz_open_file` in `crates/winbox-win16/src/lzexpand/mod.rs` call KERNEL's `OpenFile` with the program's `OFSTRUCT`. Both engines agree with [[probe:lzfiles]], with `LZEXPAND.DLL` on the drive and without it.
