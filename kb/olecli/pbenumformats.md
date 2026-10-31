---
kind: function
module: OLECLI
name: PBENUMFORMATS
ordinal: 810
summary: "Paintbrush's `EnumFormats`: `Native`, `OwnerLink` and a picture; a link's `ObjectLink`, its `Native` and a picture."
versions:
  '3.1': exact
probes: [olehnd, oleemb, olepbd]
source: src/win16/olecli/linked.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: an embedded object `Native`, `OwnerLink`, `CF_METAFILEPICT`, whether it has a bitmap or not; a link `ObjectLink`, `Native` where its presentation is its class's `Native`, and `CF_METAFILEPICT`.

## Nuances

- [[measured]] [[probe:olehnd]], [[probe:oleemb]]: Paintbrush's table is the embedded and linked objects' with this method and four other `PB` ones in its slots; one table for every such object, given where the object has no picture or one of its class's `Native`.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg7: Paintbrush's handler of the class `PBrush`, which `OLECLI` calls as it calls a handler library's `Dll` function, with the same arguments. Where a picture is wanted (`olerender_draw`) it asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native` (the clipboard's only where `Native` is there) -- then gives the object Paintbrush's table where it has no picture or one of another format than a picture's (seg7 `052a`, the presentation's `QueryType` answering `OLE_ERROR_GENERIC`, seg7 `09ae`).

## Implementation

WinBox's own: `src/win16/olecli/linked.ts` and its twin in `crates/winbox-win16/src/olecli/linked.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
