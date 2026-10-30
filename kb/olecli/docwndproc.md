---
kind: function
module: OLECLI
name: DOCWNDPROC
ordinal: 100
summary: 'The window procedure of `OleDocWndClass`, the class of the windows a document talks DDE through.'
versions:
  '3.1': stub
topics: [ole]
---

## Nuances

- [[measured]] As WinBox ran `OLECLI.DLL` from the drive, its entry registered `OleDocWndClass` with this procedure, no style and four bytes of window words.

## Implementation

Not yet WinBox's own: a stub. WinBox's `OLECLI` registers `OleDocWndClass` with this export's address as it starts (`start.ts`, `start.rs`), and makes no window of it yet: Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").
