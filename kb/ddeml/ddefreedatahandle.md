---
kind: function
module: DDEML
name: DdeFreeDataHandle
ordinal: 19
summary: Frees a data handle the application holds; a handle handed to a callback is DDEML's and is left alone.
probes: [ddexact]
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

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
