---
kind: function
module: OLECLI
name: OleCreateFromTemplate
ordinal: 33
summary: 'An embedded object made by its server from a template file.'
versions:
  '3.1': partial
source: crates/winbox-win16/src/olecli/mod.rs
probes: [olehnd, oledde, olepbd, olepbr]
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olehnd]]: the class is the registration database's for the template's extension -- `.hnd` registered as `OleHnd` -- and its handler's `DllCreateFromTemplate` is given the client's arguments, the template's path among them; with the class's server a file that is not there, `OLE_ERROR_LAUNCH` and no object ([[fn:OLECLI.DEFCREATEFROMTEMPLATE]]).

## Nuances

- `unrecorded`: the conversation with a server that starts. WinBox sends the documented `[StdNewFromTemplate("class","doc","template")]` on the system topic where [[fn:OLECLI.OleCreate]] sends `StdNewDocument`, then does as `OleCreate` does; a template whose extension names no class answers `OLE_ERROR_CLASS`.
- [[measured]] [[probe:oledde]], [[probe:olepbd]], [[probe:olepbr]]: an embedded or linked object -- `StdFileEditing`, a server talked to by DDE -- is WinBox's own, with `OLECLI.DLL` on the drive and without it: its `LE` method answers ([[topic:ole]], "Embedded and linked objects").

## Implementation

WinBox's own: `OleCreateFromTemplate` in `crates/winbox-win16/src/olecli/api.rs`, written from the interface and the probes, not from the code of `OLECLI.DLL` ([[topic:ole]]); no longer left to the file's code where `OLECLI.DLL` is on the drive. WinBox agrees with [[probe:olehnd]], [[probe:oledde]], [[probe:olepbd]] and [[probe:olepbr]], with `OLECLI.DLL` on the drive and without it (`crates/winbox-win16/tests/olecli.rs`).
