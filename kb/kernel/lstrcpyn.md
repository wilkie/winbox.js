---
kind: function
module: KERNEL
name: lstrcpyn
ordinal: 353
summary: Copies at most a given number of bytes of a string, its terminator among them, and always ends the copy with a terminator.
versions:
  '3.1': exact
probes: [strcpyn, enumfam]
source: src/win16/kernel/lstrcpyn.ts
---

The code is `KRNL386.EXE` segment 1, from `831f`. It takes the destination, the source and a count, pops ten bytes, and answers the destination in DX:AX.

## Observed behaviour

- [[read out]] **How much is copied.**
  - The source's length is counted with its terminator, by `repne scasb` from 0FFFFh.
  - Where the count is less, the count is taken instead. The two are compared unsigned, so a count of −1 copies the whole string.
  - One fewer than that many bytes are copied, and a terminator written after them. A count of 1 writes the terminator alone.
  - Nothing past the source's own terminator is read, except with a count of nought.
- [[measured]] [[probe:strcpyn]] copies `"Hello"` with counts of 1, 2, 3, 5, 6, 7, 12 and −1 into twelve bytes of `x`. Each answers the buffer, and the bytes after the terminator are left as they were. `""` with a count of 4 writes the terminator alone. `"Hello world"` with 12 fills the twelve bytes exactly.
- [[read out]] **Forward, a word at a time.** The bytes go across by `rep movsw`, then `rep movsb` for the odd one. Each word is read before it is written.
- [[measured]] So a string copied one byte up over itself does not repeat its first byte. `"abcdefgh"` copied to its own second byte with a count of 8 leaves `aabbddff` and a terminator. A byte at a time would leave eight `a`s.
- [[read out]] **A count of nought** is one less than nought: 65535 bytes are copied, terminators and all, and a terminator written at the 65536th.
- [[measured]] Between two blocks of 64K, a source of `Hi` with a `Z` at its last byte but one comes across whole: the first four bytes are `Hi` and two noughts, and the last two are the `Z` and the terminator written over what was there.

## Nuances

- [[read out]] There is no check of either pointer beforehand. KERNEL keeps a chain of guarded ranges in segment 1, each a link back, a start, an end and a place to go on a fault. The one at `a928` covers `8326` to `834a`, the scan and the copy, and goes to `8356`, which answers NULL. winbox.js has no such guard: a bad pointer is the engine's own fault, and the NULL answer is not followed.
- Not yet measured: a double-byte character set, which the code does not look at.

## Programs

- [[measured]] [[probe:enumfam]] copies each font's face, full name and style out of the structures `EnumFontFamilies` hands it with `lstrcpyn`. The Rust engine runs the probe itself, and while `lstrcpyn` was a stub that answered nought and copied nothing, it agreed with 29 of 162 records on the VGA and the Super VGA, and 29 of 176 on the EGA and the Hercules. The TrueType families had no full name or style, and every family's name, kept with `lstrcpyn` to look it up again, was empty, so none of the calls by name were recorded. With it, all four agree in full. The TypeScript engine replays the probe through its exports, and never ran the probe's own copies. See [[topic:font-enumeration]].

## Implementation

`src/win16/kernel/lstrcpyn.ts`, and `lstrcpyn` in `crates/winbox-win16/src/kernel.rs`, follow the read-out: the length, the lesser of the two, words then a byte, then the terminator, each offset within its segment. See [[fn:KERNEL.lstrcpy]].
