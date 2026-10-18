---
kind: function
module: DDEML
name: DdeFreeDataHandle
ordinal: 19
summary: Frees a data handle the application holds; a handle handed to a callback is DDEML's and is left alone.
versions:
  '3.1': exact
probes: [ddexact]
source: src/win16/ddeml/data.ts
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] It answers 1: for a handle the application made, for an `HDATA_APPOWNED` handle after two pokes, for a handle a request answered, and for the handle an `XTYP_ADVDATA` callback was given — whose data still read back afterwards.
- [[measured]] It sets no error.

## Nuances

- [[read out]] It always answers 1 (`DDEML.DLL` seg1 `1995`). A handle flagged as handed to a callback is not touched (`1975`).
- [[read out]] The block goes when the handle has `fRelease` in its header or is the application's with its count come to nought; otherwise the record alone is freed (`64c4`).
- [[read out]] It reads the handle before checking it for nought (`1962`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1946`; `64c4` takes the handle out of the instance's list and frees the block, `691a` deleting a bitmap's or metafile's object first.

## Implementation

WinBox's own: `freeDataHandle` in `src/win16/ddeml/data.ts` and `free_data_handle` in `crates/winbox-win16/src/ddeml/data.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. A handle handed to a callback, flagged 4000h, is left; any other is let go (`free`, `free_value`, seg1 `64c4`) and its six bytes freed. Both engines agree with [[probe:ddexact]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
