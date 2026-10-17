---
kind: function
module: VER
name: GetFileVersionInfo
ordinal: 7
summary: A file's version information read into a buffer — GetFileResource of the version resource, from the place the handle gives, or found again where it is nought.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] reads each file's version information with the handle and length [[fn:VER.GetFileVersionInfoSize]] gave, and `COMMDLG.DLL`'s with handles and lengths of its own.

- [[measured]] With its handle and length, the block, whole: its length, the 52 bytes of its value, the key `VS_VERSION_INFO`, and the byte after it untouched.
- [[measured]] A handle of nought finds the resource, and reads no more than it has: 1000 bytes asked for, 472 read, and 1.
- [[measured]] With its handle and more bytes than the resource has, the bytes after it are read too, and 1 where the file has them.
- [[measured]] Another handle is a place to read from, whatever is there: the handle + 2 gives the block from its third byte; 40h gives the old header's bytes; `WIN.INI` at 4 gives its text. Past the end of the file, nought.

## Nuances

- [[read out]] The arguments: a far pointer to the name, the handle and the length as doublewords, a far pointer to the buffer; it pops 16 bytes and answers a `BOOL`.

## Inside Windows

[[read out]] `VER.DLL` seg3 `0906`: [[fn:VER.GetFileResource]] of type 16, number 1, at the handle's place, of the length given.

## Implementation

`GetFileVersionInfo` in `src/win16/ver/ver.ts` and `get_file_version_info` in `crates/winbox-win16/src/ver/mod.rs`. Both engines agree with [[probe:verinfo]], with `VER.DLL` on the drive and without it.
