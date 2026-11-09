---
kind: function
module: OLECLI
name: LEACTIVATE
ordinal: 216
summary: "An embedded or linked object's `Activate` method, which its table holds."
versions:
  '3.1': partial
probes: [oledde, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:oledde]], [[probe:olepbd]]: Open: `[StdDoVerbItem("item",verb,show,!focus)]`, released `OLE_RUN`. Not open: its server reached or launched shown; an embedded object `[StdEditDocument("doc")]`, its `Native` and what its client set poked, advised, the verb; a link advised and its item asked for, the verb; released `OLE_ACTIVATE`.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`'s `method`, written from OLE 1.0's documented protocol and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]], "Embedded and linked objects").
