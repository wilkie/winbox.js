---
kind: function
module: VER
name: VerQueryValue
ordinal: 11
summary: A value in a version block found by its path — each part looked for among the children of the block before it by lstrcmpi, the backslashes between passed over; the value's place in the block and its length given back.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] asks for 25 paths of `COMMDLG.DLL`'s block and of two blocks Open Watcom wrote, and asks of blocks made too short; it records the answer, the value's offset in the block, its length (BEEFh where none was written) and the value, and whether the block is as it was after.

- [[measured]] `\`, nothing, and `\\\\` give the root's value, `VS_FIXEDFILEINFO`, at 20 (14h), 52 bytes.
- [[measured]] `\VarFileInfo\Translation` gives 4 bytes, `0904E404`; so do the same without its first backslash, in lower case, with a backslash after, and with two between its parts.
- [[measured]] `\VarFileInfo` and `\StringFileInfo` give their blocks' values, of no bytes, at their ends; `\StringFileInfo\040904e4\CompanyName` gives `Microsoft Corporation`, 23 bytes with its nought.
- [[measured]] A part not there, `\VarFileInfo\Trans`, `\None`, a path past a string (`...\CompanyName\More`), and the root's own key (`\VS_VERSION_INFO`) answer nought, nothing written.
- [[measured]] The block is as it was after each.
- [[measured]] Without a place for the length, the value is still found.
- [[measured]] A block of 4 bytes answers nought, nothing written; of 5, the root's value, 52 bytes. A block of 50h bytes gives its root's value, but not `\VarFileInfo\Translation`.

## Nuances

- [[read out]] The arguments: far pointers to the block, the path, the far pointer to be written and the length's word; it pops 16 bytes and answers a `BOOL`. The length is a `UINT`; it is written only where its pointer is not null.
- [[read out]] While it walks, the block's last byte is made nought, and the byte after each part of the path, and both are put back; a path in read-only memory faults.
- [[read out]] A block's children must fit: the root's `wLength` no more than the bytes left to its end; a child longer than 5 bytes and no longer than what is left of its parent.
- [[read out]] Parts are compared with USER's `lstrcmpi`.

## Inside Windows

[[read out]] `VER.DLL` seg3 `0943` ([[format:version-resources]]):

1. A root of less than 5 bytes, by its signed `wLength`, is nought. Its last byte is kept and made nought.
2. For each part: the backslashes before it passed over; what is left from the block to the root's end must be 5 bytes or more and at least the block's `wLength`; its first child is after its key and value, each rounded up to four bytes, and must be within it.
3. The part is cut at its next backslash with a nought, and the children compared with it in turn until one's key is the same, each next child at its `wLength` rounded up to four.
4. The last block found: its `wValueLength` written to the length, its value's far pointer -- after its key, rounded up -- to the pointer. 1.

## Implementation

`VerQueryValue` in `src/win16/ver/ver.ts` and `ver_query_value` in `crates/winbox-win16/src/ver/mod.rs` walk the block in the caller's memory, as VER does, and compare with USER's `lstrcmpi`. Both engines agree with [[probe:verinfo]], with `VER.DLL` on the drive and without it.
