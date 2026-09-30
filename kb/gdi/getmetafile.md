---
kind: function
module: GDI
name: GetMetafile
ordinal: 124
summary: A metafile on disk by its file's name — a handle of kind 2 naming the file, which is read each time the metafile is played.
versions:
  '3.1': exact
probes: [diskmeta]
source: src/win16/gdi/metafile.ts
topics: [metafiles]
---

## Observed behaviour

[[measured]] [[probe:diskmeta]] reads back a metafile that [[fn:GDI.CreateMetafile]] wrote to disk, and plays it. The handle is a block of 192 bytes: the file's header with its kind 2, and the file's `OFSTRUCT` naming it ([[topic:metafiles]]). Played, it draws what the metafile made in memory draws. [[fn:GDI.GetMetafileBits]] answers the same handle, still of kind 2.

Asked for a file that is not there, Windows did not answer: the probe never came back from the call. winbox.js answers nought.

winbox.js agrees with every record. It had answered nought for every file.
