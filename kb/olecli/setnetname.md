---
kind: function
module: OLECLI
name: SETNETNAME
ordinal: 951
summary: "A link's network name told from its document's drive: the share a remote drive is connected to."
versions:
  '3.1': partial
probes: [olenet]
source: src/win16/olecli/network.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olenet]], with no network: a link to a file on C: or with no drive answers `OLE_OK` and forgets a network name its stream gave it (saved again with none); on a drive that is not there `OLE_ERROR_DRIVE` (27); an embedded object `OLE_OK`.

## Nuances

- `unrecorded`: a remote drive -- its share kept, with the drive's letter.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg8: `0000`, given an object: an embedded object `OLE_OK`; a document with no name `OLE_ERROR_BLANK`; with no colon second, or on a drive not remote, the network name forgotten; on a drive not there (`GetDriveType` nought) `OLE_ERROR_DRIVE`; on a remote drive the share `WNetGetConnection` gives kept with the drive's letter, or `OLE_ERROR_DRIVE` where it gives none.

## Implementation

WinBox's own: `src/win16/olecli/network.ts` and its twin in `crates/winbox-win16/src/olecli/network.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
