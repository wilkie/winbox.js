---
kind: topic
name: Metafiles
summary: What Windows 3.1 keeps when a program draws into a metafile — the header, each record's number and words, how objects are made and selected — and how the metafile plays back, as the metafile probe recorded them byte for byte.
probes: [metafile, diskmeta]
---

A metafile is a picture kept as the GDI calls that drew it, to be played again. A program makes one with [[fn:GDI.CreateMetafile]], draws into the device context it gives, and has the metafile from [[fn:GDI.CloseMetafile]]. [[measured]] [[probe:metafile]] draws 24 calls into a memory metafile. It dumps its bytes, plays it whole with [[fn:GDI.PlayMetafile]], and plays it again a record at a time through [[fn:GDI.EnumMetafile]] and [[fn:GDI.PlayMetafileRecord]]. winbox.js agrees with all 112 records.

## The bytes

- **The header**, nine words: 1 for a memory metafile, the header's own size of 9, version 300h, the metafile's size in words, a doubleword, how many objects its handle table needs, the largest record in words, a doubleword, and nought.
- **A record** is its size in words, a doubleword, its function, a word, and what the call was given.
- **A call given only numbers** is kept as its own stack, less the device context: its arguments last first, as they were pushed. `Rectangle(2, 2, 20, 14)` is 14, 20, 2, 2. The function's low byte is the call's ordinal in GDI, and its high byte how many words it pushed: `Rectangle` is 041Bh, `SetPixel` 041Fh, `PatBlt` 061Dh, `SaveDC` 001Eh.
- **A call given a pointer** keeps what it points at:
  - `TextOut`: its count, then its text padded to a word, then y and x.
  - `Polygon` and `Polyline`: the count, then the points in order.
  - `ExtTextOut`: y, x, the count, the options, the rectangle, then the text.

  The function's high byte is still the words the call pushed: `Polygon` is 0324h, `ExtTextOut` 0A32h.
- **An object selected** is first made in the lowest free place of the metafile's handle table. A pen is made by `CreatePenIndirect`, 02FAh, with its `LOGPEN`; a brush by `CreateBrushIndirect`, 02FCh, with its `LOGBRUSH`. A font is made by `CreateFontIndirect`, 02FBh, with its `LOGFONT`, keeping its face name, its nought and two bytes more, to a word. The two bytes are whatever was in GDI's memory. Then `SelectObject`, 012Dh, names its place. A stock object is made too: the black pen, with its width nought.
- **An object deleted** with [[fn:GDI.DeleteObject]], a call that is given no device context, is still taken out of a metafile that holds it: 01F0h with its place, which is then free.
- **The end** is a record of three words.

## Playing it

- Every call into a metafile's device context answers 1.
- A metafile's handle is the global block of its bytes. [[fn:GDI.GetMetafileBits]] and [[fn:GDI.SetMetafileBits]] give the same handle back. The block holds more than the metafile.
- `EnumMetafile` calls its procedure with each record but the last, a handle table as large as the header says, and that count.
- `PlayMetafile` does not put the device context back. The mode, the colours and the clip a metafile set are left set: played a second time, a metafile that ends in `R2_NOT` draws inverted ([[fn:GDI.SetROP2]]).

## On disk

[[measured]] [[probe:diskmeta]] makes a metafile in a file, reads it back with [[fn:GDI.GetMetafile]], and copies it with [[fn:GDI.CopyMetafile]] to another file and to memory, and one in memory to a file.

- **The file** holds the same bytes a metafile in memory holds, its header's kind still 1.
- **The handle** of a metafile on disk is a block of 192 bytes. It holds the header with its kind 2, six bytes, and then the file's `OFSTRUCT`: its length byte, eight more than the path's; 1, for a fixed disk; no error; the file's date and time; and its path in capitals.
- [[fn:GDI.GetMetafileBits]] of one on disk answers the same handle, still of kind 2. `SetMetafileBits` of it plays as it did. [[fn:GDI.DeleteMetafile]] leaves the file.
- **A copy** to its own kind keeps the header's size. A copy from disk to memory or from memory to disk says three words more than it holds, though it holds, and writes, the same bytes.
- A metafile on disk plays as the one in memory does.

## In winbox.js

`src/win16/gdi/metafile.ts`. A GDI call whose device context is a metafile's is kept as a record where it is dispatched, in `syscallInvoke`, not drawn. The calls measured, and those given only numbers that the rule covers, are kept. A metafile on disk is written when it is closed. To be played or copied, it is read into a block of its own. Not yet done: bitmaps, regions, palettes and `PolyPolygon` in a metafile. A call into a metafile that is not kept answers nought.
