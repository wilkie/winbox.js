---
kind: function
module: KERNEL
name: OpenPathName
ordinal: 75
summary: A file opened as named, or else in each of PATH's directories: DOS's answer, or FFFFh.
versions:
  '3.1': exact
probes: [kmore]
records: [path]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `04be`-`0505`. The mode is a DOS function and its AL: one with no function is an open, 3Dh. The call is made on the path as given; failing, on the path's name (past its last `\`, `/` or `:`, seg1 `5a0e`) in each of PATH's directories in turn, a backslash between, as KERNEL's search looks there (seg1 `588e`), the path built in KERNEL's frame. The answer is AX as DOS left it on the first that did not fail, or FFFFh where none did. Where the byte at 282h of KERNEL's data is set -- NetWare's function DCh, which KERNEL calls as it starts, sets it (seg1 `b9a8`) -- the file's attributes are asked first (4300h). DS is left as it was.
- [[measured]] [[probe:kmore]]: a file named with its directory, and WIN.INI named with no directory, open (modes 0 and 3D02h); a name that is nowhere answers FFFFh (PATH is Z:\ under DOSBox).

## Nuances

- Under DOSBox, NetWare's function DCh leaves AL nought, so the attributes are never asked first; WinBox does not ask them.

## Implementation

`crates/winbox-win16/src/kernel_calls/more.rs`.
