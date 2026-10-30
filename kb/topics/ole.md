---
kind: topic
name: Object linking and embedding
summary: OLE 1.0's client library, OLECLI.DLL, as WinBox's own -- client documents, static objects (pictures, bitmaps, DIBs, another class's data), their streams, drawing, queries and the clipboard -- written from the documented interface and from probes, not from the library's code; and what of embedding, linking and OLESVR is not yet done.
probes: [olestat, olemem]
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

What WinBox's does not do yet -- embedded and linked objects, which need a server -- is left to the file where it is on the drive, as it was before (`fileFirst`, `or_file`): [[fn:OLECLI.OleLoadFromStream]], the `OleCreate` calls and the clipboard's queries and creations with `StdFileEditing`, and [[fn:OLECLI.OleLockServer]] and [[fn:OLECLI.OleUnlockServer]] of an object not WinBox's, are the file's code. The object the file makes is used through its own method table thereafter, as every `Ole` function uses an object, in a document of WinBox's: the file lays a document's block out as WinBox does, and takes a block that starts `CD` for one. With no file, those calls are refused.

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

## Not yet done

- **Embedded and linked objects** (`StdFileEditing`): the 200s of `OLECLI`'s exports, launching a class's server from the registration database, and the DDE conversation with it -- `WM_DDE_INITIATE` on the class and the document, `[StdNewDocument]` and the rest, `Native` and a picture advised and requested, `OLE_CHANGED`, `OLE_SAVED` and `OLE_CLOSED` told the client. With `OLECLI.DLL` on the drive the file's code makes and serves them; with none, [[fn:OLECLI.OleCreate]] and its kind answer `OLE_ERROR_LAUNCH` for a class the database has, and [[fn:OLECLI.OleLoadFromStream]] answers `OLE_ERROR_PROTOCOL` for an embedded or linked object's stream. Recorded, not yet followed: `oracle/probes/oleemb.c` and its fixture, an embedded object with native data and a picture, one with none, and a linked one, each made by hand as MS-OLEDS lays them out and read with `StdFileEditing` by Windows' `OLECLI` with no server started -- their method tables (the 200s and entries 1000-1005), their 160-byte blocks, `Native` and `OwnerLink` data (the topic made of the document's class, file and the object's name and a number, `OLEEMB%EMB.DOC%Obj#001`), `OLE_ERROR_NOT_OPEN` from `OleQueryOpen`, their streams written back. Some of its records hold what the machine's memory held, and it is not yet registered. Still to be recorded: the conversation Windows' `OLECLI` holds with a server, by a probe acting as the server and logging what it is sent, with Paintbrush as a real one.
- **Object handlers**: the `DEF` exports (110-117) and a class's handler DLL found in the registration database.
- **Packager's objects** (800-812) and the network helpers (950-954).
- **`OLESVR.DLL`**: not WinBox's own; with the file on the drive the file runs, as before.
- `DOCWNDPROC` and `SRVRWNDPROC`, the procedures of the classes WinBox's `OLECLI` registers: stubs, no window of them made yet.
