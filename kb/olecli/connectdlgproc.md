---
kind: function
module: OLECLI
name: CONNECTDLGPROC
ordinal: 950
summary: "One of `OLECLI`'s own network or window helpers (950-954): for a linked object's file on a network drive, and a task's window."
versions:
  '3.1': stub
topics: [ole]
---

## Implementation

Not WinBox's own: a stub. Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").
