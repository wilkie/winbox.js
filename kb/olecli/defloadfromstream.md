---
kind: function
module: OLECLI
name: DEFLOADFROMSTREAM
ordinal: 110
summary: "An object handler's default for `OleLoadFromStream`: the stream read on from its class, the object made."
versions:
  '3.1': partial
probes: [olehnd]
source: src/win16/olecli/handlers.ts
topics: [ole]
---

## Observed behaviour

- [[documented]] The OLE 1.0 programmer's reference, object handlers: a class's handler library is named under `class\protocol\StdFileEditing\handler` in the registration database; `OLECLI` calls its `Dll` function in place of its own, which may call this default to make the object and then change its methods.
- [[measured]] [[probe:olehnd]]: its handler is given the client's own arguments -- the protocol, client, document, name and out pointer, the rendering and format as passed -- and this default's answer is the `Ole` function's; a handler that answers `OLE_ERROR_GENERIC` without it leaves no object.
- [[measured]] [[probe:olehnd]]: `OleLoadFromStream` reads the version, type and class, then calls `DllLoadFromStream` with the stream there, the type, the class as an atom (spelled as the atom table has it, a document's class registered first giving its spelling) and a format of nought; this default reads the rest -- document, item, `Native` or network name, presentation -- as `OleLoadFromStream` does.
- [[measured]] [[probe:olehnd]]: called directly, the stream after the class: an embedded and a linked object made, the stream read to its end.

## Nuances

- [[measured]] [[probe:olehnd]]'s `atom` records: the object takes the class's atom it is given -- let go with the object -- and adds none of its own.
- [[measured]] [[probe:olehnd]]: the default does not look at the protocol: given `Static` it makes an embedded object as for `StdFileEditing`.
- `unrecorded`: what the format argument does.

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
