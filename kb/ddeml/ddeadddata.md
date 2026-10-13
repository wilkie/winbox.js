---
kind: function
module: DDEML
name: DdeAddData
ordinal: 15
summary: Writes bytes into a data handle at an offset, growing its block when they go past the end.
probes: [ddexact]
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] Three bytes at offset 4 of `abcdefgh` give `abcdXYZh`, and the same handle back.
- [[measured]] Two bytes at offset 60 of a handle of 28 grow it: the same handle, now 92, the bytes read back at 60.
- [[measured]] On a handle a transaction answered it is refused: nought, with `DMLERR_INVALIDPARAMETER`.

## Nuances

- [[read out]] It refuses a handle that is read-only — sent or received — or not in the instance's list (`DDEML.DLL` seg1 `15cf`-`1605`).
- [[read out]] Growing is `GlobalReAlloc(GMEM_MOVEABLE)` and, failing that, a new `GMEM_DDESHARE | GMEM_MOVEABLE` block copied (`1647`-`169c`). Nothing fills the gap between the old end and the offset.
- [[read out]] It does not check its handle for nought before reading it (`15a5`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1598`.

## Implementation

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
