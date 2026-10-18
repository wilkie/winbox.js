---
kind: function
module: DDEML
name: DdeCreateDataHandle
ordinal: 14
summary: Makes a DDEML data handle — a GMEM_DDESHARE block with DDE's header when an item is given — copying the caller's bytes in at an offset.
versions:
  '3.1': exact
probes: [ddexact]
source: src/win16/ddeml/data.ts
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] Nine bytes with an item: a handle whose size, by [[fn:DDEML.DdeGetData]], is 28, the global block's 32 less DDE's four-byte header.
- [[measured]] With no item, eight bytes of nothing: the handle's size is the whole block, 32, and its first four bytes are `00 20 01 00`, the header DDEML wrote before it knew there was none.
- [[measured]] An offset of three puts the bytes three in, and the size is still the block's: 28.
- [[measured]] No bytes at all still make a handle, of size 28.
- [[measured]] Flags other than `HDATA_APPOWNED` are refused: nought, and `DMLERR_INVALIDPARAMETER`.

## Nuances

- [[read out]] Only whether the item is nought matters: the handle does not keep it (`DDEML.DLL` seg1 `1536`, `63cc`-`63dc`).
- [[read out]] The header's status is `fRelease` for DDEML's data and `fAckReq` for the application's (`63e0`-`63ee`); the format is not checked.
- [[read out]] The block is `GlobalAlloc(GMEM_DDESHARE)`, not zeroed: bytes the caller does not give are what the heap held (`5b22`).
- [[read out]] A bad instance identifier answers nought and sets no error (`14fb`-`150a`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `14e8` checks the flags, `63c6` allocates, writes the header and copies, and the six-byte record the handle points at is allocated in the instance's local heap (`154f`-`1577`).

## Implementation

WinBox's own: `createDataHandle` in `src/win16/ddeml/data.ts` and `create_data_handle` in `crates/winbox-win16/src/ddeml/data.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The block is `GMEM_DDESHARE` with DDE's header where there is an item (`make`, seg1 `63c6`), and the handle six bytes of the instance's heap. Both engines agree with [[probe:ddexact]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
