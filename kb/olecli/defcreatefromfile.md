---
kind: function
module: OLECLI
name: DEFCREATEFROMFILE
ordinal: 115
summary: "An object handler's default, which a handler's own calls to do what `OLECLI` would have done (the OLE 1.0 reference's object handlers)."
versions:
  '3.1': stub
topics: [ole]
---

## Implementation

Not WinBox's own: a stub. Embedded and linked objects -- `StdFileEditing`, a server talked to by DDE -- are not yet WinBox's: with `OLECLI.DLL` on the drive the file's code makes them and answers for them, as before; with none they are refused ([[topic:ole]], "Not yet done").
