---
kind: function
module: OLECLI
name: GETTASKVISIBLEWINDOW
ordinal: 954
summary: "`EnumTaskWindows`' procedure finding a task's visible window: it written where the far pointer given points."
versions:
  '3.1': exact
probes: [olenet]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olenet]]: a visible window FALSE, the window written; a hidden one TRUE, nothing written; through `EnumTaskWindows` the task's visible window, none where none is.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg8: `0696`, given a window and a far pointer: `IsWindowVisible`, then the window written and FALSE, or TRUE. [[fn:OLECLI.CHECKNETDRIVE]]'s dialog is owned by the window it finds.

## Implementation

WinBox's own: `crates/winbox-win16/src/olecli/network.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). WinBox agrees with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).
