---
kind: function
module: DDEML
name: DdeGetData
ordinal: 16
summary: Copies a data handle's bytes, from an offset, into the caller's buffer, or with no buffer answers the handle's size.
probes: [ddexact]
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] With no buffer it answers the size: 28 for nine bytes made with an item, 32 for a handle with none — the global block's size, less the header where there is one.
- [[measured]] With a buffer of four, it copies four. From offset 2, with room for 40, it copies 26, to the block's end. From offset 9 it copies 19.
- [[measured]] From offset 200 it answers nought and sets `DMLERR_INVALIDPARAMETER`.

## Nuances

- [[read out]] The size is `GlobalSize`'s, so it is rounded up as the global heap rounds (`DDEML.DLL` seg1 `17d9`).
- [[read out]] The size with no buffer ignores the offset (`1830`-`1852`).
- [[read out]] It locks the block and does not unlock it (`1854`-`187b`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `17a8`.

## Implementation

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
