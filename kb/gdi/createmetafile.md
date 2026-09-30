---
kind: function
module: GDI
name: CreateMetafile
ordinal: 125
summary: Opens a metafile to draw into, in memory or in a file; its device context keeps each call as a record until CloseMetafile makes it a metafile.
versions:
  '3.1': exact
probes: [metafile, diskmeta]
source: src/win16/gdi/metafile.ts
topics: [metafiles]
---

## Observed behaviour

[[measured]] [[probe:metafile]] makes a memory metafile with `CreateMetafile(NULL)`, draws 24 calls into it and closes it. Every call answers 1, and the bytes kept are the ones [[topic:metafiles]] sets out. winbox.js keeps the same bytes, and agrees with all 112 records.

[[measured]] [[probe:diskmeta]] names a file instead. The same records go to the file, whose header still says kind 1, 130 bytes for seven calls. [[fn:GDI.CloseMetafile]] answers a handle of kind 2 that names the file ([[topic:metafiles]]). On a drive that is not there, `CreateMetafile` answers nought. [[fn:GDI.DeleteMetafile]] leaves the file where it is. winbox.js agrees with every record.
