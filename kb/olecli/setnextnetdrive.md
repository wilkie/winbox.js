---
kind: function
module: OLECLI
name: SETNEXTNETDRIVE
ordinal: 953
summary: "The next remote drive connected to a link's share: the drive's number moved past each looked at."
versions:
  '3.1': partial
probes: [olenet]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olenet]], with no network: nought. A link with no network name leaves the number and buffer as they were; one with a share, or a share given, has the number moved to 26 and the share written into an empty buffer.

## Nuances

- `unrecorded`: a remote drive connected to the share -- the link's document moved to it, 1.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg8: `025c`, given an object, a far pointer to a drive's number and a buffer: an empty buffer given the link's network name, none nought; then each drive after the number, to 26, that `GetDriveType` calls remote and whose share `WNetGetConnection` gives the same, the link's drive made it and its document moved there (seg8 `031a`).

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/network.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).
