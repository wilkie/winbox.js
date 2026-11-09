---
kind: function
module: GDI
name: CreateMetafile
ordinal: 125
summary: Opens a metafile to draw into, in memory or in a file; its device context keeps each call as a record until CloseMetafile makes it a metafile.
versions:
  '3.1': exact
probes: [metafile, diskmeta, metarec]
source: crates/winbox-win16/src/gdi/metafile.rs
topics: [metafiles]
---

## Observed behaviour

[[measured]] [[probe:metafile]] makes a memory metafile with `CreateMetafile(NULL)`, draws 24 calls into it and closes it. Every call answers 1, and the bytes kept are the ones [[topic:metafiles]] sets out. winbox.js keeps the same bytes, and agrees with all 112 records.

[[measured]] [[probe:metarec]] makes each call GDI keeps, and some it does not, into a metafile of its own. Not every call answers 1. `SelectObject` answers the object of its kind selected before, at first the stock black pen, white brush and device default font. `FloodFill` and `ExtFloodFill` answer nought, though they are kept. A call that asks answers nought, and [[fn:GDI.GetDeviceCaps]] answers `DT_METAFILE` for `TECHNOLOGY`. The metafile's block is nine words longer than the metafile. winbox.js agrees with all 140 records.

[[measured]] [[probe:diskmeta]] names a file instead. The same records go to the file, whose header still says kind 1, 130 bytes for seven calls. [[fn:GDI.CloseMetafile]] answers a handle of kind 2 that names the file ([[topic:metafiles]]). On a drive that is not there, `CreateMetafile` answers nought. [[fn:GDI.DeleteMetafile]] leaves the file where it is. winbox.js agrees with every record.
