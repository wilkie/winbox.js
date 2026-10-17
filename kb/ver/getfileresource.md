---
kind: function
module: VER
name: GetFileResource
ordinal: 3
summary: A resource's bytes read from a file — found as GetFileResourceSize finds it, as many as asked for or as it has; or, given a place, as many as asked for from there, whatever is there.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] reads resources, 24 bytes into a buffer filled with CCh, and reads at places it gives itself.

- [[measured]] With a place of nought the resource is found and read, no more than its length: `COMMDLG.DLL`'s string table 25, 1040 bytes, gives 24, and the answer is 1.
- [[measured]] With a place given, the type and resource are not looked at: 4 bytes at 3Ch give the new header's place, 80h, and 1.
- [[measured]] Past the file's end, nought: a read that comes short fails, and what it read is left in the buffer (`getinfo` 8 bytes before the end, 16 asked for).
- [[measured]] A length of nought is 1, nothing read.
- [[measured]] A file not there, nought.

## Nuances

- [[read out]] The arguments, as pushed: far pointers to the file's name, the type and the resource, the place and the length as doublewords, and a far pointer to the buffer; it pops 24 bytes and answers a `BOOL`.
- [[read out]] The buffer is huge: it is read 4000h bytes at a time, the selector stepped by `__AHINCR` past each 64K (seg3 `07c9`).
- [[read out]] A place given is opened as a file, not as a program: no header is checked.

## Inside Windows

[[read out]] `VER.DLL` seg3 `017e`. A place of nought: the file opened and its resource found as [[fn:VER.GetFileResourceSize]] finds it (seg3 `0488`, `05d2`), the place and length taken from it, the length asked for cut to the resource's. A place given: [[fn:LZEXPAND.LZOpenFile]] sharing, then in compatibility mode. Then (seg3 `0776`) [[fn:LZEXPAND.LZSeek]] to the place, which must answer it, and the bytes read (seg3 `07c9`): [[fn:LZEXPAND.LZRead]] of 4000h at a time while more than 4000h are left, a short read ending it, then the rest; the answer is 1 only where all were read. The file is closed either way.

## Implementation

`GetFileResource` in `src/win16/ver/ver.ts` and `get_file_resource` in `crates/winbox-win16/src/ver/mod.rs`. Both engines agree with [[probe:verinfo]], with `VER.DLL` on the drive and without it.
