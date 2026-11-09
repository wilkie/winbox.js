---
kind: function
module: OLECLI
name: DEFCREATEFROMCLIP
ordinal: 111
summary: "An object handler's default for `OleCreateFromClip`: an embedded or linked object of the clipboard's `OwnerLink` or `ObjectLink`."
versions:
  '3.1': partial
probes: [olehnd]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[documented]] The OLE 1.0 programmer's reference, object handlers: a class's handler library is named under `class\protocol\StdFileEditing\handler` in the registration database; `OLECLI` calls its `Dll` function in place of its own, which may call this default to make the object and then change its methods.
- [[measured]] [[probe:olehnd]]: its handler is given the client's own arguments -- the protocol, client, document, name and out pointer, the rendering and format as passed -- and this default's answer is the `Ole` function's; a handler that answers `OLE_ERROR_GENERIC` without it leaves no object.
- [[measured]] [[probe:olehnd]]: `DllCreateFromClip` is given `OleCreateFromClip`'s arguments and the type, `OT_EMBEDDED`; the default makes the object as `OleCreateFromClip` does: `Native` and `OwnerLink`, and a picture -- the clipboard's first with `olerender_draw`, the format asked with `olerender_format`, none with `olerender_none`, which then enumerates no picture's format and has no bounds (`OLE_ERROR_BLANK`).

## Nuances

- [[measured]] [[probe:olehnd]]: called other than inside `OleCreateFromClip` -- by a program itself, the clipboard open and full -- `OLE_ERROR_MEMORY` (4) and no object. [[read out]] seg3 `30c2`: it reads what the `Ole` function took from the clipboard, and with none fails.
- [[read out]] seg5 `00fe`: a type of `OT_LINK` makes a link as [[fn:OLECLI.DEFCREATELINKFROMCLIP]]; another than embedded or linked `OLE_ERROR_CLIPBOARD` (`unrecorded`).

## Implementation

WinBox's own: `src/win16/olecli/handlers.ts` and its twin in `crates/winbox-win16/src/olecli/handlers.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
