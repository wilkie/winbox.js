---
kind: function
module: OLECLI
name: PBLOADFROMSTREAM
ordinal: 800
summary: "Paintbrush's handler's `Dll` function for `OleLoadFromStream`: its default asked for no picture, Paintbrush's table given an object with none."
versions:
  '3.1': partial
probes: [olehnd, oleemb]
source: src/win16/olecli/handlers.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: called directly, the stream after its class: an embedded object with no presentation given Paintbrush's table, one with a picture the embedded and linked objects' table; the class's atom taken by the object, as [[fn:OLECLI.DEFLOADFROMSTREAM]] takes it.
- [[measured]] [[probe:olehnd]] and [[probe:oleemb]]: `OleLoadFromStream` of `PBrush` the same -- a link whose presentation is its class's `Native` Paintbrush's table too.

## Nuances

- `unrecorded`: a rendering other than `olerender_draw` passed on as given.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg7: Paintbrush's handler of the class `PBrush`, which `OLECLI` calls as it calls a handler library's `Dll` function, with the same arguments. Where a picture is wanted (`olerender_draw`) it asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native` (the clipboard's only where `Native` is there) -- then gives the object Paintbrush's table where it has no picture or one of another format than a picture's (seg7 `052a`, the presentation's `QueryType` answering `OLE_ERROR_GENERIC`, seg7 `09ae`).

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
