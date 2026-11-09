---
kind: function
module: OLECLI
name: PBQUERYBOUNDS
ordinal: 806
summary: "Paintbrush's `QueryBounds`: its bitmap's size at its pixels to a metre."
versions:
  '3.1': exact
probes: [olehnd, oleemb, olepbd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: an 8 by 4 bitmap at 3780 pixels to a metre `0,0,211,-105`, in `MM_HIMETRIC`; with no bitmap noughts and `OLE_ERROR_BLANK`. [[probe:oleemb]]: the object's block keeps no bounds.

## Nuances

- [[measured]] [[probe:olehnd]], [[probe:oleemb]]: Paintbrush's table is the embedded and linked objects' with this method and four other `PB` ones in its slots; one table for every such object, given where the object has no picture or one of its class's `Native`.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg7: Paintbrush's handler of the class `PBrush`, which `OLECLI` calls as it calls a handler library's `Dll` function, with the same arguments. Where a picture is wanted (`olerender_draw`) it asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native` (the clipboard's only where `Native` is there) -- then gives the object Paintbrush's table where it has no picture or one of another format than a picture's (seg7 `052a`, the presentation's `QueryType` answering `OLE_ERROR_GENERIC`, seg7 `09ae`).

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/linked.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).
