---
kind: function
module: OLECLI
name: PBCOPYTOCLIPBOARD
ordinal: 807
summary: "Paintbrush's `CopyToClipboard`: `Native`, `OwnerLink` and a picture made from its bitmap."
versions:
  '3.1': exact
probes: [olehnd, oleemb, olepbd]
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: called directly and through [[fn:OLECLI.OleCopyToClipboard]], `Native`, `OwnerLink` and `CF_METAFILEPICT` on the clipboard.

## Nuances

- [[measured]] [[probe:olehnd]], [[probe:oleemb]]: Paintbrush's table is the embedded and linked objects' with this method and four other `PB` ones in its slots; one table for every such object, given where the object has no picture or one of its class's `Native`.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg7: Paintbrush's handler of the class `PBrush`, which `OLECLI` calls as it calls a handler library's `Dll` function, with the same arguments. Where a picture is wanted (`olerender_draw`) it asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native` (the clipboard's only where `Native` is there) -- then gives the object Paintbrush's table where it has no picture or one of another format than a picture's (seg7 `052a`, the presentation's `QueryType` answering `OLE_ERROR_GENERIC`, seg7 `09ae`).

## Implementation

WinBox's own: `src/win16/olecli/linked.ts` and its twin in `crates/winbox-win16/src/olecli/linked.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
