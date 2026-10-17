---
kind: function
module: KERNEL
name: _llseek
ordinal: 84
summary: A file's place moved from its start, its place or its end, and answered — a place before the start putting the file at its end, as DOSBox does — or HFILE_ERROR in both words.
versions:
  '3.1': partial
probes: [lzfiles]
source: src/win16/kernel/_llseek.ts
topics: [dos-handles, compressed-files]
---

## Observed behaviour

[[probe:lzfiles]] seeks a plain file of 1500 bytes through [[fn:LZEXPAND.LZSeek]], which passes a DOS handle to `_llseek` and answers its answer as it is.

- [[measured]] From the start, the place and the end: 700; -10 from the end, 1490; 2000, past the end, 2000.
- [[measured]] -1 from the start: 1500, the file's end. DOSBox's host seek fails for a place before the start, and DOSBox puts the file at its end instead (`localFile::Seek`): what a program sees on DOSBox, the oracle.
- [[measured]] An origin of 3: -1, `HFILE_ERROR`, in both words. A handle not open: -1.

## Nuances

- [[read out]] The arguments: the handle, the offset, a `LONG`, and the origin; it pops 8 bytes and answers a `LONG`.

## Implementation

`_llseek` in `src/win16/kernel/_llseek.ts` and `llseek` in `crates/winbox-win16/src/files_kernel.rs` move the file's place as DOS function 42h does (`dos_seek` in `crates/winbox-win16/src/dos.rs`, `seek` in `src/dos/syscall/seek.ts`), a place before the start the file's end, and answer -1 for a handle not open or an origin past 2. Both engines agree with [[probe:lzfiles]].

## Not yet done

- KERNEL's own code, which calls DOS function 42h: not read out. The answers here are what the probe recorded.
