---
kind: function
module: OLESVR
name: DELETECLIENTINFO
ordinal: 29
summary: "The procedure `OLESVR.DLL` hands `EnumProps` for an item's window as the item goes: a client's block freed and its property taken away."
versions:
  '3.1': partial
probes: [oleitem]
source: crates/winbox-win16/src/olesvr/mod.rs
topics: [ole]
---

## Observed behaviour

- [[read out]] `OLESVR.DLL` seg3 `222e`-`22a9`: called with the item's window, a property's name and its datum. Where the datum names a client's block, its target device's block is freed; where the item is being let go so, [[fn:OLESVR.TERMINATEDOCCLIENTS]] is called for the client with the item's parent; the block is freed. Then the property is taken away by its name, whatever the datum. The answer is always 1.
- [[measured]] [[probe:oleitem]]: the probe's own window, a property of its own and nought: 1, the property gone. Item3's window, a conversation's property and its datum: 1, and `GetProp` finds it no more.

## Nuances

- [[documented]] OLE 1.0's headers and reference name no function `DELETECLIENTINFO`: it is exported so USER can call it back, as `EnumChildWindows` and `EnumProps` do. A program can call it through `GetProcAddress`, as [[probe:oleitem]] does.
- [[measured]] [[probe:oleitem]]: after the second call Windows' `EnumProps` still lists the property, though `GetProp` no longer finds it. USER's `RemoveProp` (seg13 `1057`-`1147`) and `EnumProps` (seg13 `114a`-`120f`), read out, give no cause, and WinBox's lists it no more: a known gap of one record.

## Implementation

WinBox's own: `deleteClientInfo` in `src/win16/olesvr/server.ts` and `delete_client_info` in `crates/winbox-win16/src/olesvr/server.rs`. Both engines hand it USER as the file does, and agree with [[probe:oleitem]] but for its one known gap ([[topic:ole]]), [[probe:olesrv]] and [[probe:olepbr]], with `OLESVR.DLL` on the drive and without it (`test/win16/olesvr_test.ts`, `crates/winbox-win16/tests/olesvr.rs`).
