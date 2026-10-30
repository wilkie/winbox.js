---
kind: topic
name: Object linking and embedding
summary: OLE 1.0's client library, OLECLI.DLL, as WinBox's own -- client documents, static objects, and embedded and linked objects with the DDE conversation each holds with its server, Paintbrush's objects drawn from their bitmaps -- written from the documented interface and from probes, not from the library's code; and what of OLESVR and object handlers is not yet done.
probes: [olestat, olemem, oledde, olepbd]
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

What WinBox's does not do yet is left to the file where it is on the drive (`fileFirst`, `or_file`): [[fn:OLECLI.OleCreateFromTemplate]] with `StdFileEditing`, and [[fn:OLECLI.OleLockServer]] and [[fn:OLECLI.OleUnlockServer]] of an object not WinBox's. The object the file makes is used through its own method table thereafter, as every `Ole` function uses an object, in a document of WinBox's. With no file, those are refused.

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
- [[measured]] [[probe:olepbd]] is the same with the server registered as `PBrush`, its `Native` a bitmap file, and `olepbr` (not registered: Paintbrush takes minutes to run under WinBox) is Paintbrush itself, a server over Windows' `OLESVR`.

An object is a block of A0h bytes ([[probe:oleemb]]), its method table the `LE` exports and entries 1000-1005; what WinBox keeps beyond the block's first words -- its class, document, item, `Native`, presentation, conversations and steps -- is kept beside it (`linked.ts`, `linked.rs`). [[measured]] [[probe:oledde]]:

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

[[measured]] [[probe:olepbd]]: `OLECLI` treats the class `PBrush` as its own. It keeps no picture of a Paintbrush object: only `Native` is advised and asked for (a link's item in `Native`, kept as a presentation of the class's `Native`), its stream has no presentation, its bounds are its bitmap's at its pixels to a metre, it is drawn from its bitmap, and `OleGetData` makes a picture for its caller, `OLE_WARN_DELETE_DATA`. These are the `PB` exports' (800-812) in `OLECLI.DLL`'s tables ([[probe:oleemb]]); WinBox does them in its `LE` methods.

## Not yet done

- **What no probe has measured yet**: `OleUpdate` of an object not open (answered `OLE_OK`, nothing asked); `OleShow`, `OleCopyFromLink`, `OleObjectConvert`, `ChangeData` and `ObjectLong` of an embedded or linked object (`OLE_ERROR_GENERIC`); `OleCreateFromTemplate` (the file's where it is on the drive, else `OLE_ERROR_LAUNCH`); `OleCreateInvisible` to be activated (done as `OleCreate`); renderings other than `olerender_draw`; a server that answers `OLEsystem`; a server that refuses; the network helpers.
- **Paintbrush itself** (`olepbr`): WinBox's `OLECLI` holds the conversation with Paintbrush and its answers agree as far as WinBox runs it in a probe's time; not registered, as it takes minutes.
- **The method table of an object with no picture** ([[probe:oleemb]]'s `bare`, the `PB` exports): WinBox gives every embedded and linked object the `LE` table. `oleemb` stays unregistered: some of its records hold what the machine's memory held.
- **Object handlers**: the `DEF` exports (110-117) and a class's handler DLL found in the registration database.
- **Packager's objects** and the network helpers (950-954).
- **`OLESVR.DLL`**: not WinBox's own; with the file on the drive the file runs, as before.
