---
kind: function
module: GDI
name: CopyMetafile
ordinal: 151
summary: Copies a metafile to a file, answering one on disk, or to memory; a copy from one kind to the other says three words more in its header's size than it holds.
versions:
  '3.1': exact
probes: [diskmeta, metafile]
source: src/win16/gdi/metafile.ts
topics: [metafiles]
---

## Observed behaviour

[[measured]] [[probe:diskmeta]] copies a metafile on disk to another file and to memory, and one in memory to a file and to memory.

- **To a file:** the same bytes are written, and the answer is a metafile on disk naming the new file.
- **To none:** the answer is a metafile in memory.
- **The size:** a copy to its own kind keeps the header's size. A copy from disk to memory, or from memory to disk, says three words more than it holds. The copy from memory writes 130 bytes to its file, but its header says 44h words, 136 bytes. Played, both copies draw what the original draws.

winbox.js agrees with every record. It had not made a copy on disk.
