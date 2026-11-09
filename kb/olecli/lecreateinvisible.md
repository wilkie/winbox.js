---
kind: function
module: OLECLI
name: LECREATEINVISIBLE
ordinal: 230
summary: '`DefCreateInvisible` without its protocol: the client, class, document, name, out pointer, rendering, format and whether to activate.'
versions:
  '3.1': partial
probes: [olehnd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]], called directly: not to be activated, an embedded object made, `OLE_OK`, as [[fn:OLECLI.DEFCREATEINVISIBLE]] makes it -- with `olerender_none` enumerating no picture; to be activated with no server to start, `OLE_ERROR_LAUNCH`.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg5 `02e0`: [[fn:OLECLI.DEFCREATEINVISIBLE]] passes its arguments but the protocol to entry 230, seg4 `322c`.

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
