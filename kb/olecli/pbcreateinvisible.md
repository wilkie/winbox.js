---
kind: function
module: OLECLI
name: PBCREATEINVISIBLE
ordinal: 812
summary: "Paintbrush's handler's `Dll` function for `OleCreateInvisible`: its default asked for no picture, Paintbrush's table given an object with none."
versions:
  '3.1': partial
probes: [olehnd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: not to be activated, an embedded object with no `Native` and Paintbrush's table: no bounds, no size, `Native`, `OwnerLink` and a picture enumerated; [[fn:OLECLI.OleCreateInvisible]] of `PBrush` the same.

## Nuances

- `unrecorded`: a rendering other than `olerender_draw` passed on as given.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg7: Paintbrush's handler of the class `PBrush`, which `OLECLI` calls as it calls a handler library's `Dll` function, with the same arguments. Where a picture is wanted (`olerender_draw`) it asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native` (the clipboard's only where `Native` is there) -- then gives the object Paintbrush's table where it has no picture or one of another format than a picture's (seg7 `052a`, the presentation's `QueryType` answering `OLE_ERROR_GENERIC`, seg7 `09ae`).

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
