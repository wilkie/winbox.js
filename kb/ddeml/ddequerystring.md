---
kind: function
module: DDEML
name: DdeQueryString
ordinal: 23
summary: A string handle's text, copied as far as it fits, or its length with no buffer; an instance's own name written with its frame window after it.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: with no buffer it answers the length, 7 for `Service`. Into 4 bytes it copies `Ser` and answers 3.
- [[measured]] A handle of nought writes an empty string and answers nought.
- [[measured]] A code page of 1200 answers nought with `DMLERR_INVALIDPARAMETER`, 4006h.
- [[measured]] A handle with a high word -- the kind DDEML gives `XTYP_REGISTER` as an instance's own name -- is written with the high word in hex after it: `Service:(12ab)`, 14 characters. Into 12 bytes only the name fits, and it answers 7. With no buffer it answers 14.

## Nuances

- [[read out]] The suffix is `:(%04x)`, written with `wsprintf` only where seven more characters fit (`DDEML.DLL` seg1 `2ef0`-`2f18`); otherwise the name alone. The length with no buffer always counts it (`2ea1`).
- [[read out]] The code page is checked as [[fn:DDEML.DdeCreateStringHandle]] checks it, and nothing is converted.

## Inside Windows

[[read out]] Seg1 `1b14`: the instance checked and its last error cleared; the code page checked; with a buffer, [[fn:USER.GlobalGetAtomName]] of the low word (`2eb6`); without, the same into 256 bytes of its own, to count (`2e72`).

## Implementation

WinBox's own: `queryString` in `src/win16/ddeml/instance.ts` and `query_string` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. An instance's own name gets `:(hhhh)` after it, as the file's `wsprintf` writes it. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
