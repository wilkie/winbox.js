---
kind: function
module: OLECLI
name: CHECKNETDRIVE
ordinal: 952
summary: "Whether a link's drive is still connected to its share; another drive found, or the dialog asking for one."
versions:
  '3.1': partial
probes: [olenet]
source: src/win16/olecli/network.ts
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olenet]], with no network: an embedded object, and a link with no network name, `OLE_OK`; a link whose stream names a share `OLE_ERROR_NETWORK` (28) not to ask, and asking, [[fn:OLECLI.CONNECTDLGPROC]]'s dialog shown, owned by the task's visible window, and cancelled: 28, the link unchanged.

## Nuances

- `unrecorded`: a drive connected to the share, and a drive connected from the dialog -- the link's document moved to it.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg8: `011a`, given an object and a word, whether to ask: the link's drive -- kept, or its document's first letter -- asked of `WNetGetConnection`, its share compared; else the drives after B: searched as [[fn:OLECLI.SETNEXTNETDRIVE]] searches them; none found and not to ask `OLE_ERROR_NETWORK`; to ask, the dialog `CONNECTDLG` shown by `DialogBoxParam` (seg8 `03a4`), its owner the first visible window `EnumTaskWindows` gives [[fn:OLECLI.GETTASKVISIBLEWINDOW]], given the share's name; its answer the drive's letter, nought `OLE_ERROR_NETWORK`; a drive connected, the link's document moved to it (seg8 `031a`).

## Implementation

WinBox's own: `src/win16/olecli/network.ts` and its twin in `crates/winbox-win16/src/olecli/network.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
