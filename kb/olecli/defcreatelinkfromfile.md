---
kind: function
module: OLECLI
name: DEFCREATELINKFROMFILE
ordinal: 116
summary: "An object handler's default for `OleCreateLinkFromFile`: a link to a file's item."
versions:
  '3.1': partial
probes: [olehnd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[documented]] The OLE 1.0 programmer's reference, object handlers: a class's handler library is named under `class\protocol\StdFileEditing\handler` in the registration database; `OLECLI` calls its `Dll` function in place of its own, which may call this default to make the object and then change its methods.
- [[measured]] [[probe:olehnd]]: its handler is given the client's own arguments -- the protocol, client, document, name and out pointer, the rendering and format as passed -- and this default's answer is the `Ole` function's; a handler that answers `OLE_ERROR_GENERIC` without it leaves no object.
- [[measured]] [[probe:olehnd]]: the class's server a file that is not there, `OLE_ERROR_LAUNCH` (35) and no object, called by the handler and called directly.

## Nuances

- With a server, it does what [[fn:OLECLI.OleCreateLinkFromFile]] does ([[probe:oledde]]).

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
