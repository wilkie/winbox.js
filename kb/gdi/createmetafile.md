---
kind: function
module: GDI
name: CreateMetafile
ordinal: 125
summary: Opens a memory metafile to draw into; its device context keeps each call as a record until CloseMetafile makes it a metafile.
versions:
  '3.1': exact
probes: [metafile]
source: src/win16/gdi/metafile.ts
topics: [metafiles]
---

## Observed behaviour

[[measured]] [[probe:metafile]] makes a memory metafile with `CreateMetafile(NULL)`, draws 24 calls into it and closes it. Every call answers 1, and the bytes kept are the ones [[topic:metafiles]] sets out. winbox.js keeps the same bytes, and agrees with all 112 records.

- Not done: a metafile on disk, named by the file it is to be kept in. winbox.js answers nought for one.
