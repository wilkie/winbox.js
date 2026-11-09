---
kind: topic
name: Object linking and embedding
summary: OLE 1.0's two libraries as WinBox's own -- OLECLI.DLL's client documents, static objects, and embedded and linked objects with the DDE conversation each holds with its server, Paintbrush's objects drawn from their bitmaps by OLECLI's own handler, a class's object handler library and the defaults it calls, a link's network drive and the dialog that connects one; OLESVR.DLL's servers, documents and objects on the other side of that conversation -- written from the documented interface and from probes, not from the libraries' code.
probes: [olestat, olemem, oledde, olepbd, olesrv, olehnd, olenet, oleemb, oleitem]
---

OLE 1.0 is two libraries over DDE. A **client** -- Write, Cardfile -- keeps objects in its documents through `OLECLI.DLL`; a **server** -- Paintbrush, Packager -- makes and edits them through `OLESVR.DLL`. The two talk by DDE messages ([[topic:dynamic-data-exchange]]): the server's class is found in the registration database ([[topic:registration-database]]), started, and asked for the object's native data and a picture of it.

An object is a far pointer to a structure whose first field is its method table, `OLEOBJECTVTBL`, 39 methods long (ole.h). Every `Ole` function of the client library is a method of the object it is given: the library checks the arguments, then calls the method in the object's table. What the client keeps is in its documents, registered with [[fn:OLECLI.OleRegisterClientDoc]].

Three protocols are named: `StdFileEditing` for embedded and linked objects, which have a server; `Static` for a picture, a bitmap or a DIB, which has none; and `StdExecute` for DDE commands. A static object is the part every program that pastes OLE data uses, and it is wholly observable: everything it does is on its client's side.

## What WinBox does

**Behaviour first.** WinBox's `OLECLI` is written from OLE 1.0's documented interface and from probes under DOSBox. Its code is not a translation of `OLECLI.DLL`'s: a read-out of the library settled one question a probe could not (below), and is described here in prose.

The documentation relied on:

- [[documented]] `ole.h`, the OLE 1.0 header, in Open Watcom's Windows headers: the structures (`OLEOBJECTVTBL`, `OLECLIENTVTBL`, `OLESTREAMVTBL`, the server's tables), the `OLESTATUS` codes, the release methods, the rendering and update options, and every function's arguments.
- [[documented]] The Windows 3.1 SDK's OLE 1.0 programmer's reference: what each function does, the protocols, the registration database's keys, the object handlers' defaults, the stream's layout -- the version, the type, the class, then the class's data.
- [[measured]] [[probe:olestat]]: static objects from the clipboard, their queries, their streams byte for byte, loaded again, cloned, compared, drawn into a metafile and a bitmap, copied to the clipboard, every method a static object refuses, streams made by hand, and every call with a NULL or a wrong handle.
- [[measured]] [[probe:olemem]]: the blocks behind a document's handle and an object's pointer, word by word, each word named by what it is (an atom of a name, a selector, a handle); each kind's method table by the export each slot is; each method called through the table beside its `Ole` function; the metafile a drawing leaves, record by record; and the measurements that settled the rules below.
- [[measured]] The calls `OLECLI.DLL` makes into KERNEL, USER and GDI, seen with their arguments as WinBox ran the file from the drive: an API monitor's view, the library's interface below it. They give the order of WinBox's own calls, which is what keeps atoms, handles and freed memory as the file leaves them.

### Kept with its file, kept only once loaded

`OLECLI` is kept as `DDEML` is ([[guide:without-windows]], `own-modules.ts`): with `OLECLI.DLL` on the drive a program that imports it gets the file's library -- its entry runs -- and each import of an export, and `GetProcAddress`, is linked to WinBox's stub. Every export is answered. With no file, WinBox's own is found by the file's name and counted as the file would be.

What WinBox's does not do yet is left to the file where it is on the drive (`fileFirst`, `or_file`): [[fn:OLECLI.OleLockServer]] and [[fn:OLECLI.OleUnlockServer]] of an object not WinBox's. The object the file makes is used through its own method table thereafter, as every `Ole` function uses an object, in a document of WinBox's. With no file, those are refused.

It is kept only once a program loads it (`keepOnLoad`, `own_modules::keep_on_load`): a kept module takes two descriptors, and one kept as Windows starts would move every selector every program is given. A session that never loads OLE is as it was. What the file does as it loads -- the seven clipboard formats of OLE's protocol, its two window classes `OleDocWndClass` and `OleSrvrWndClass`, thirteen atoms -- WinBox's does as a program first calls it, the same in both engines. Its data goes with its library.

### Documents and objects

[[measured]] [[probe:olemem]]: a document's handle is the far pointer to a block of 18h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE`:

| Offset | What                                             |
| ------ | ------------------------------------------------ |
| 0      | `CD`                                             |
| 2      | its first object, a far pointer                  |
| 6      | its last object                                  |
| 10     | its class's atom                                 |
| 12     | its name's atom                                  |
| 14     | the block's own handle                           |
| 16     | the document registered before it, a far pointer |
| 20     | the document registered after it                 |

A handle is a document's where its block can be read and starts `CD`: a string that starts so is taken for one ([[probe:olestat]]).

[[measured]] [[probe:olemem]]: an object's pointer is to a block of 48h bytes for a picture, 3Ah for the others, `GMEM_MOVEABLE | GMEM_ZEROINIT`:

| Offset | What                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0      | its method table, a far pointer, as `OLEOBJECT` has it                                                                                                                               |
| 4      | `LE`, which every `Ole` function checks                                                                                                                                              |
| 6      | the block's own handle                                                                                                                                                               |
| 8      | its client                                                                                                                                                                           |
| 12     | its type, 3 for static                                                                                                                                                               |
| 16, 20 | its width and height in `MM_HIMETRIC`, the height negative                                                                                                                           |
| 24     | 8 for a picture, its mapping mode; 1 for the others                                                                                                                                  |
| 28     | FFFFh                                                                                                                                                                                |
| 30     | its name's atom                                                                                                                                                                      |
| 32     | its document                                                                                                                                                                         |
| 36, 40 | the objects before and after it                                                                                                                                                      |
| 30h    | a picture's size, mode, extents, metafile and `METAFILEPICT`; a bitmap's size, width, height and bitmap; a DIB's size and block; another class's format, class's atom, size and data |
| 3Eh    | a picture's drawing: into a metafile, the error that stopped it, the records left before its client is asked                                                                         |

[[measured]] Each kind's table: a picture's methods are exports 300-310, a bitmap's 400-410, a DIB's 500-510, another class's 600-611; the methods every kind refuses are the `ERR` exports, 701-718, and those it shares the `OBJ` exports, 910-913; five slots hold entries with no name, 1026-1030. WinBox's tables are in its `OLECLI`'s data segment and hold its stubs' addresses, which `GetProcAddress` gives for the same ordinals.

### What a static object does

[[measured]] [[probe:olestat]] and [[probe:olemem]]:

- **Made** from the clipboard by [[fn:OLECLI.OleCreateFromClip]], from the first of its formats that is a picture, a DIB or a bitmap; only a picture of `MM_ANISOTROPIC` is taken. Its bounds are a picture's extents (nought where the width is not more than nought), a bitmap's pixels at the screen's resolution (or its dimension times ten), a DIB's at its pels to a metre (the screen's, written into its header, where nought).
- **Streamed** a field at a time: 0501h, the type, the class with its length, the width, the height, the data's size and the data -- a `METAFILEPICT` and its metafile's whole block, a `BITMAP` and its bits, a DIB's whole block; another class's format, or nought and the format's name, then its data. A format's name of nought bytes read back leaves the last one read in its place.
- **Drawn**: a picture's records enumerated and played, into a metafile its window mapped onto the window's bounds, every sixteenth record its client asked `OLE_QUERY_PAINT`; a bitmap stretched from a context compatible with the target, none into a metafile; a DIB through a palette of its colours.
- **Refuses** what needs a server: `OLE_ERROR_STATIC` from most methods, `OLE_ERROR_MEMORY` from `SetData` and `SetBounds`.

[[read out]] One rule was settled by reading the library, because no probe could say why a bitmap was not equal to itself: [[fn:OLECLI.BMEQUAL]] (`OLECLI.DLL` seg11 `00e4`) compares the bits by its entry 1031 (seg3 `38a6`), which answers 1 for the same, and turns 1 into `OLE_ERROR_NOT_EQUAL`. [[probe:olemem]] then measured two bitmaps that differ: equal.

### Embedded and linked objects

The documentation relied on beside `ole.h`: [[documented]] the OLE 1.0 programmer's reference's description of the DDE protocol a client and a server hold -- the `System` topic and a document's, the execute strings `StdNewDocument`, `StdEditDocument`, `StdOpenDocument`, `StdCloseDocument`, `StdShowItem` and `StdDoVerbItem`, the items `StdHostNames`, `StdTargetDevice`, `StdDocDimensions`, `StdColorScheme` and `StdDocumentName`, the formats `Native`, `OwnerLink`, `ObjectLink` and `Binary`, `/Save`, `/Close` and `/Change` advised, and a class's server found under `class\protocol\StdFileEditing\server` in the registration database -- and what the probes measured:

- [[measured]] [[probe:oledde]] registers its second program as the server of a class and speaks the protocol by hand, writing into the probe's file every message `OLECLI` sends it -- its conversation, item, format, flags and data -- so the file holds both sides in the order they happened.
- [[measured]] [[probe:olepbd]] is the same with the server registered as `PBrush`, its `Native` a bitmap file, and [[probe:olepbr]] is Paintbrush itself, a server over `OLESVR` -- Windows' under DOSBox, WinBox's or the file's under WinBox.

An object is a block of A0h bytes ([[probe:oleemb]]), its method table the `LE` exports and entries 1000-1005; what WinBox keeps beyond the block's first words -- its class, document, item, `Native`, presentation, conversations and steps -- is kept beside it (`crates/winbox-win16/src/olecli/linked.rs`). [[measured]] [[probe:oledde]]:

- **Reaching a server.** `WM_DDE_INITIATE` is sent to every window on the class and `OLEsystem`, then `System`; where none answers, the class's server is started -- `server -Embedding`, and the file for a link or an object made from a file -- shown where the object is made or activated, hidden where only its data is wanted, and both are asked again. A link's document is asked for by its file as the topic. A running server is used without a launch.
- **Made** (`OleCreate`): `[StdNewDocument("class","doc")]` on `System`, the document's conversation begun, `/Save` and `/Close` advised in `Native` and a picture, `[StdShowItem("")]`; released `OLE_CREATE`. The document is the client's class, its file's name, the object's name and its number: `OleDdeClient%OLEDDE.DOC%Obj1#001`, each embedded object numbered as it is made, loaded, cloned or pasted.
- **Activated** when closed: `[StdEditDocument("doc")]`, its `Native` poked, then what its client set -- `StdHostNames` (two offsets and the names), `StdTargetDevice`, `StdDocDimensions` (the width and height, twice), `StdColorScheme` (the `LOGPALETTE`) -- advised as made, `[StdDoVerbItem("item",verb,show,!focus)]`. Open, only the verb, released `OLE_RUN`.
- **Set while open**: each poke released `OLE_OTHER`; `OleSetData` tells its client `OLE_CHANGED` at once and pokes `Native`, `OLE_SETDATA`. Set while closed: kept for the next opening.
- **Updated**: `Native` and a picture asked for, its client told `OLE_CHANGED`, `OLE_UPDATE`; `OleRequestData` the one format, `OLE_REQUESTDATA`, a refusal released with `OLE_ERROR_REQUEST_PICT`, which `OleQueryReleaseError` answers only inside the client's `OLE_RELEASE`.
- **The server's data**: `/Save` and `/Close` kept and acknowledged -- `/Close` not -- its client told `OLE_SAVED` or `OLE_CHANGED` as the picture comes; a link's item told `OLE_CHANGED`; `StdDocumentName` with no data is told `OLE_CHANGED` and not acknowledged.
- **Closed** (`OleClose`, and `OleRelease` or `OleDelete` of an open object, then let go): `[StdCloseDocument]`, the document's conversation ended, then `System`'s; a link's conversation ended. The server closing its document: its client told `OLE_CLOSED`, then the same closing, busy throughout but telling no release.
- **Links**: made from a file -- its item and `StdDocumentName` advised, its picture asked for, the conversation ended; activated, the same and the verb; `OleReconnect` connects to a server that has the document open, launching none.
- **From a file** (embedded): `Native` and a picture asked for, the conversation ended, `OLE_CREATEFROMFILE`. `OleCreateInvisible` not activated starts no server. `OleLockServer` reaches or launches the server hidden; `OleUnlockServer` ends that conversation.
- **From the clipboard**: `OwnerLink`'s class and item with `Native` and a picture, or a link to `ObjectLink`'s document; no server is asked.
- **Streams**: 0501h, the type, the class, the document and item (an embedded object's document none), `Native` or a link's network name, nought and update option, then the presentation as a static object's but of type 5, or 0501h and nought.

[[measured]] [[probe:olepbd]]: `OLECLI` treats the class `PBrush` as its own. It keeps no picture of a Paintbrush object: only `Native` is advised and asked for (a link's item in `Native`, kept as a presentation of the class's `Native`), its stream has no presentation, its bounds are its bitmap's at its pixels to a metre, it is drawn from its bitmap, and `OleGetData` makes a picture for its caller, `OLE_WARN_DELETE_DATA`. These are OLECLI's own handler of the class, below.

### Object handlers

[[documented]] The OLE 1.0 programmer's reference: a class may name a library under `class\protocol\StdFileEditing\handler` in the registration database, its object handler. `OLECLI` calls the handler's `DllCreate`, `DllCreateFromClip`, `DllCreateLinkFromClip`, `DllCreateFromTemplate`, `DllCreateFromFile`, `DllCreateLinkFromFile`, `DllCreateInvisible` or `DllLoadFromStream` in place of its own way of making the object; the handler may call `OLECLI`'s default of the same name -- [[fn:OLECLI.DEFCREATE]] and the other `Def` exports, 110-117 -- and change the object it makes.

- [[measured]] [[probe:olehnd]] registers its library, `OLEHNDD.DLL`, as `OleHnd`'s handler; the library writes down every call it is given and calls the defaults. Each `Ole` function checks its arguments and the class, then gives the handler the client's own arguments; `OleLoadFromStream` reads the version, type and class first and gives the stream there, the type, the class as an atom and a format of nought; `OleCreateFromClip` the type, `OT_EMBEDDED`; `OleCreateFromTemplate` the class the template's extension names in the registration database. The handler's answer is the client's; one that answers `OLE_ERROR_GENERIC` without its default leaves no object. A clone is not made by the handler.
- [[measured]] The library is loaded once, the first time its class's object is made, and held after its objects are let go, until the client document is revoked. [[read out]] `OLECLI.DLL` seg2 `02b6` (entry 961) asks the registration database, finds a class loaded before by its atom, loads the library and wants all seven exports but `DllCreateInvisible` -- a library without one is let go and the class has no handler; each object made through the handler counts it, and a failure puts the count back (seg3 `1646`-`16e6`); an object let go counts it down (entry 986), and a library none of whose objects is left is freed only when another's are, or as [[fn:OLECLI.OleRevokeClientDoc]] begins (entry 1023). A handler with no `DllCreateInvisible` is called at `DllCreate` for [[fn:OLECLI.OleCreateInvisible]], its default told to make the object hidden.
- [[measured]] A handler that puts its own method in its object's table changes every embedded and linked object's: the table is one, in `OLECLI`'s data ([[probe:olehnd]]'s `override`). WinBox's table is in its own data the same way, so a handler's method is called through it.
- [[measured]] The defaults, called directly ([[probe:olehnd]]'s `def`): they do not look at the protocol; [[fn:OLECLI.DEFLOADFROMSTREAM]]'s object takes the class's atom it is given; the clipboard's two answer `OLE_ERROR_MEMORY` but inside `OleCreateFromClip` or `OleCreateLinkFromClip` ([[read out]] seg3 `30c2`: they read what the `Ole` function took from the clipboard); [[fn:OLECLI.LECREATEINVISIBLE]] is [[fn:OLECLI.DEFCREATEINVISIBLE]] without its protocol. An object rendered `olerender_none` enumerates no picture's format. An embedded object made from a file whose server cannot be started takes no number.

### Paintbrush's handler

[[read out]] `OLECLI.DLL` seg7: the `Pb` exports (800-804, 808, 809, 812) are `OLECLI`'s own handler of the class `PBrush`, called as a library's `Dll` functions are, with the same arguments. Where a picture is wanted (`olerender_draw`) each asks its default for none -- an embedded object `olerender_none`, a link `olerender_format` of `Native`, the clipboard's only where `Native` is there -- and gives an object with no picture, or with a presentation of its class's `Native`, Paintbrush's table: the embedded and linked objects' with [[fn:OLECLI.PBGETDATA]], [[fn:OLECLI.PBENUMFORMATS]], [[fn:OLECLI.PBCOPYTOCLIPBOARD]], [[fn:OLECLI.PBDRAW]] and [[fn:OLECLI.PBQUERYBOUNDS]] in their slots (seg7 `052a`). [[measured]] [[probe:olehnd]] and [[probe:oleemb]]: one table for every such object; an object with a picture keeps the embedded and linked objects' table and is drawn from the picture; a clone holds its original's table. Those five draw, measure and copy the object from its bitmap, and make a picture for `OleGetData`; the object's block keeps no bounds. WinBox's `PB` table is in its `OLECLI`'s data at 600h, beside the `LE` table at 500h.

### A link's network drive

[[read out]] `OLECLI.DLL` seg8, the network helpers (950-954), undocumented: a link's stream keeps its document's network name, the share its drive was connected to. [[fn:OLECLI.SETNETNAME]] tells it from the drive; [[fn:OLECLI.CHECKNETDRIVE]] checks the drive is still connected to it, finds another that is ([[fn:OLECLI.SETNEXTNETDRIVE]]), or shows the dialog "Connect Network Drive", whose procedure is [[fn:OLECLI.CONNECTDLGPROC]] and whose owner [[fn:OLECLI.GETTASKVISIBLEWINDOW]] finds. [[measured]] [[probe:olenet]], on DOSBox with no network: what each answers for a link on C:, on a drive not there, with no drive, one naming a share, and an embedded object; the dialog shown -- every control's class, number, text, style and place -- and cancelled. WinBox's dialog is laid out from those measurements, at two pixels to a dialog unit, no byte of the library's resource copied; a link keeps its network name and saves it again.

## OLESVR

`OLESVR.DLL` is the other end of the conversation: a server registers itself and its documents with it, hands it method tables -- `OLESERVER`'s seven methods, `OLESERVERDOC`'s eight, and `OLEOBJECT`'s first ten for each object -- and it answers the client's DDE messages by calling them. WinBox's `OLESVR` is its own, written as `OLECLI` was: from `ole.h`'s server declarations and the programmer's reference's description of the server API and the protocol, and from a probe.

- [[measured]] [[probe:olesrv]] registers its second program as the server of a class; that program registers itself with `OleRegisterServer` and writes into the probe's file every method OLESVR calls, with its arguments and answer. The probe is the client, speaking the protocol by hand, and writes every message it sends and is sent -- the window that answered, the item, format, flags, status and data. It is named `olesrv` and not `olesvr`: a program whose module is named `OLESVR` is the module its server's imports of `OLESVR` are found in.
- [[measured]] As WinBox ran `OLESVR.DLL` from the drive, each call its code made into USER, KERNEL and SHELL logged: what its entry does as it loads (21 atoms, the formats `Native`, `Binary`, `ObjectLink`, `OwnerLink`, the classes `SrvrWndClass`, `DocWndClass`, `ItemWndClass`), which WinBox's does as a program first calls it.
- [[measured]] [[probe:oleitem]] looks at the windows the library keeps its clients on: the probe, as client, speaks to `OLEITEMC.EXE` as `olesrv` does and, between messages, walks the server window's children -- each one's class, parent, text, style, id, window words and properties -- and calls the library's internal exports through `GetProcAddress`. The server's child tells which of its objects a pointer is.
- [[read out]] A read-out of `OLESVR.DLL` settled what the probe could not see: which internal export does what, the fields of the blocks it keeps, and when it calls a server's `Release`. It is described in prose on each export's page and cited by segment and offset; none of its code or data is copied.

### Kept with its file

As `OLECLI` is, and kept only once a program loads it: with `OLESVR.DLL` on the drive the file is loaded beside WinBox's and every import of an export linked to WinBox's stub; with none, WinBox's is found by its file's name. A program another starts -- a server launched by `OLECLI` -- finds a module kept only on load as there when its imports are checked (`keptOnLoad`, `own_modules::kept_on_load`).

### What a server sees

[[measured]] [[probe:olesrv]]:

- **Servers and documents.** A server's handle is a hidden top-level window of `SrvrWndClass`, its task's; a document's, a `DocWndClass` window, the server's child. Broadcast `WM_DDE_INITIATE` reaches only the server's window, which answers its class and `OLEsystem` -- never `System` -- and its documents' names from their windows. A class not in the registration database is `OLE_ERROR_CLASS`.
- **One document an instance.** A server registered `OLE_SERVER_MULTI` that has a document answers no initiate on `OLEsystem` and refuses every `StdNewDocument`, `StdEditDocument`, `StdOpenDocument` and `StdNewFromTemplate`: `OLECLI` starts another instance. `OLE_SERVER_SINGLE` takes them all.
- **The system topic.** The four commands are the server's `Create`, `Edit` (given the server's class), `Open` and `CreateFromTemplate`, each with a new document's handle; `StdExit` its `Exit`. A wrong count of arguments, another `Std` command or text not in brackets is refused without a call; anything else in brackets is the server's `Execute`, its answer the acknowledgement's. `Topics` answers `Doc`, `Formats` `Picture` and `Bitmap`, `Status` `Ready`.
- **A document's topic.** An item's object is the document's `GetObject`, asked once, with an `OLECLIENT` OLESVR gives; a format is found by `EnumFormats` from nought. An advise is acknowledged only where it asks for `fAckReq`; a request answered flags 3000h. Pokes: `StdHostNames` is `SetHostNames`, `StdDocDimensions` `SetDocDimensions` with a rectangle from nought (the first width and height), `StdColorScheme` `SetColorScheme`, `StdTargetDevice` kept for each object's first data, anything else `SetData`. `StdShowItem` and `StdDoVerbItem` are `Show` and `DoVerb` with the focus turned over; `StdCloseDocument` is acknowledged and then `Close`; anything else the document's `Execute`.
- **What a server tells.** Its object's client's `CallBack` ([[fn:OLESVR.ITEMCALLBACK]]): a change or a save sends every format advised for the object, to each conversation that advised that time, flags 2000h; a rename sends the document named in its `ObjectLink` to `StdDocumentName`'s advisers in `Binary`, as [[fn:OLESVR.OleRenameServerDoc]] does. [[fn:OLESVR.OleSavedServerDoc]] saves each object; [[fn:OLESVR.OleRevertServerDoc]] sends nothing.
- **Revoking.** An object's `Release`, then each conversation ended; a document's `Release` and a server's as the client answers the last terminate (`OLE_WAIT_FOR_RELEASE`), at once where none is left. [[fn:OLESVR.OleRevokeObject]] ends the whole conversation the object was given in. [[fn:OLESVR.OleBlockServer]] queues what clients post until [[fn:OLESVR.OleUnblockServer]] takes it a message at a time.
- **Paintbrush.** `olepbr`'s Paintbrush serves its picture through WinBox's `OLESVR` to WinBox's `OLECLI`, with either file on the drive or neither, and writes what it wrote under Windows (`crates/winbox-win16/tests/olesvr.rs`).

### Where it keeps its clients

[[measured]] [[probe:oleitem]], with what the read-out settled:

- **Conversations** are properties of the window that answered them, the server's or a document's, named `@` and the client's window in four hex digits (`@1A2C`), the datum the client's window. A client's terminate takes its away.
- **Objects** are windows of `ItemWndClass`, text `ITEM`, `WS_CHILD`, hidden, beneath their document's window (text `Doc`), in the order made. An item window's words point at the `OLECLIENT` its object was given: a block of 10h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE`, locked, holding the client's method table, the object, the block's handle, the item's atom -- nought for the document itself -- and the item window. A request or an advise of an item makes it; it goes as its object is released ([[fn:OLESVR.FINDITEMWND]], [[fn:OLESVR.DELETECLIENTINFO]]).
- **What a client asked of an item** is a block of the library's, named by the datum of the client's property on the item window: whether it advised native data, the one other format it advised last, a bit for each time (`Change`, `Save`, `Close`), and whether data goes with them. So a change sends native data first, then that one format, whatever order they were advised in; an unadvise takes away the time's bit for every format; an advise that defers its data is sent `WM_DDE_DATA` with no block ([[fn:OLESVR.SENDDATAMSG]]).
- **USER walks them.** The library hands `EnumProps` and `EnumChildWindows` its internal exports: [[fn:OLESVR.SENDDATAMSG]] to send a time's data, [[fn:OLESVR.FINDITEMWND]] to find an item, forget a client, let an item go or tell it saved, [[fn:OLESVR.TERMINATECLIENTS]] and [[fn:OLESVR.TERMINATEDOCCLIENTS]] to end conversations, [[fn:OLESVR.DELETECLIENTINFO]] as an item goes, [[fn:OLESVR.SENDRENAMEMSG]] and [[fn:OLESVR.ENUMFORTERMINATE]] as a document is renamed. WinBox's does the same with its own, and a program that calls them gets what the file gives.
- **A server's `Release`** is called as its last client goes -- a system conversation or a document's ended, or a document let go -- unless a document was just made for a client yet to begin its conversation; it stays registered. A multi-instance server with a system conversation answers no second on `OLEsystem`.
- **A save** of an embedded document -- made by `StdNewDocument`, `StdEditDocument` or `StdNewFromTemplate`, not renamed -- that reaches no client of one of its objects answers `OLE_ERROR_CANT_UPDATE_CLIENT`, from [[fn:OLESVR.ITEMCALLBACK]] and [[fn:OLESVR.OleSavedServerDoc]].

## Not yet done

- **What no probe has measured yet**: `OleUpdate` of an object not open (answered `OLE_OK`, nothing asked); `OleShow`, `OleCopyFromLink`, `OleObjectConvert`, `ChangeData` and `ObjectLong` of an embedded or linked object (`OLE_ERROR_GENERIC`); `OleCreateFromTemplate` with a server that starts (the documented `StdNewFromTemplate` sent); `OleCreateInvisible` to be activated with a server (done as `OleCreate`); the conversation of an object rendered other than `olerender_draw` (a class's other than Paintbrush's); a server that refuses; a handler with no `DllCreateInvisible`, and the class's atom where a handler makes nothing; a remote drive and the dialog's Connect (no network under DOSBox).
- **Packager's objects**.
- **An embedded or linked object's block** past its first 2Ch bytes: WinBox keeps what the file keeps there beside guest memory ([[probe:oleemb]]'s `obj` records write only those).
- **`OLESVR`'s known gap**: after [[fn:OLESVR.DELETECLIENTINFO]] takes a property from an item window, Windows' `EnumProps` still lists it though `GetProp` finds it no more ([[probe:oleitem]], one record). USER's `RemoveProp` and `EnumProps`, read out, give no cause.
- **`OLESVR`, not measured**: a client's target device, which the file keeps in the client's block on each item and WinBox by the document; `StdDocumentName`'s advisers, whom the file's rename path finds on an item window of their own and WinBox keeps by the document; [[fn:OLESVR.SENDRENAMEMSG]] outside a rename; the timer whose procedure is ordinal 32.
- **What no probe has measured of `OLESVR`** (`unrecorded`): NULL pointers to its functions; `OLE_CLOSED` of an object advised for `/Close`; an object's `GetData` or `SetData` that fails; an advise of a format the object does not enumerate; the system topic's `Protocols` and `EditEnvItems`; a document renamed by `OLE_RENAMED` found by its new name; Write or Cardfile embedding a Paintbrush picture (`olepbr` is a probe's client).
