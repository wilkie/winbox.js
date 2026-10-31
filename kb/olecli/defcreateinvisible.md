---
kind: function
module: OLECLI
name: DEFCREATEINVISIBLE
ordinal: 117
summary: "An object handler's default for `OleCreateInvisible`: an embedded object, its server started only to be activated."
versions:
  '3.1': partial
probes: [olehnd]
source: src/win16/olecli/handlers.ts
topics: [ole]
---

## Observed behaviour

- [[documented]] The OLE 1.0 programmer's reference, object handlers: a class's handler library is named under `class\protocol\StdFileEditing\handler` in the registration database; `OLECLI` calls its `Dll` function in place of its own, which may call this default to make the object and then change its methods.
- [[measured]] [[probe:olehnd]]: its handler is given the client's own arguments -- the protocol, client, document, name and out pointer, the rendering and format as passed -- and this default's answer is the `Ole` function's; a handler that answers `OLE_ERROR_GENERIC` without it leaves no object.
- [[measured]] [[probe:olehnd]]: not to be activated, the object made with no server: no bounds (`OLE_ERROR_BLANK`), no size (`OLE_ERROR_BLANK`), `Native`, `OwnerLink` and a picture enumerated -- none with `olerender_none`; to be activated, `OLE_ERROR_LAUNCH` where its server cannot be started.
- [[measured]] [[probe:olehnd]]: the default does not look at the protocol: given `Static` it makes an embedded object as for `StdFileEditing`.

## Nuances

- [[read out]] seg5 `02e0`: the default is [[fn:OLECLI.LECREATEINVISIBLE]] with every argument but the protocol.

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
