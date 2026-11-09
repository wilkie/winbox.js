---
kind: topic
name: Metafiles
summary: What Windows 3.1 keeps when a program draws into a metafile — the header, each record's number and words, how objects are made and selected, what each call answers there — and how the metafile plays back, as the metafile and metarec probes recorded them byte for byte.
probes: [metafile, diskmeta, prmeta, metarec]
---

A metafile is a picture kept as the GDI calls that drew it, to be played again. A program makes one with [[fn:GDI.CreateMetafile]], draws into the device context it gives, and has the metafile from [[fn:GDI.CloseMetafile]]. [[measured]] [[probe:metafile]] draws 24 calls into a memory metafile. It dumps its bytes, plays it whole with [[fn:GDI.PlayMetafile]], and plays it again a record at a time through [[fn:GDI.EnumMetafile]] and [[fn:GDI.PlayMetafileRecord]]. [[measured]] [[probe:metarec]] makes each call GDI keeps, and some it does not, into a metafile of its own: 140 records, each the call's answer, the header's count of objects and largest record, the block's size and the records. winbox.js agrees with every record of both.

## The bytes

- **The header**, nine words: 1 for a memory metafile, the header's own size of 9, version 300h, the metafile's size in words, a doubleword, how many objects its handle table needs, the largest record in words, a doubleword, and nought.
- **A record** is its size in words, a doubleword, its function, a word, and what the call was given.
- **A call given only numbers** is kept as its own stack, less the device context: its arguments last first, as they were pushed. `Rectangle(2, 2, 20, 14)` is 14, 20, 2, 2. The function's high byte is how many words it pushed. Its low byte is the call's ordinal in GDI, less 300 from `SetTextAlign`'s, 346, on. `Rectangle` is 041Bh, `SetPixel` 041Fh, `PatBlt` 061Dh, `SaveDC` 001Eh, `SetTextAlign` 012Eh, `Chord` 0830h, `SetMapperFlags` 0231h, `ExtFloodFill` 0548h.
  - The calls kept so: the modes and colours, `SetRelAbs`, `SetTextAlign` and `SetMapperFlags`; the window and viewport calls; `MoveTo` and `LineTo`; the clip rectangles and `OffsetClipRgn`; `Arc`, `Chord`, `Pie`, `Ellipse`, `Rectangle`, `RoundRect`, `SetPixel`, `PatBlt`; `SaveDC` and `RestoreDC`; `ExtFloodFill`.
  - `FloodFill` is kept as `ExtFloodFill` with `FLOODFILLBORDER`, nought, before its words. Both answer nought.
  - The `Ex` forms, `SetWindowOrgEx` to `MoveToEx`, are kept as the call they are the form of, without their pointer. They give the pointer 1 and nought, the answer of that call, and answer 1.
  - `StartPage`, `EndPage`, `EndDoc` and `AbortDoc` are records of no words: 0051h to 0054h.
- **A call given a pointer** keeps what it points at:
  - `TextOut`: its count, then its text padded to a word, then y and x.
  - `Polygon` and `Polyline`: the count, then the points in order.
  - `PolyPolygon`, 0538h: the count of polygons, each one's count of points, then all the points.
  - `ExtTextOut`, 0A32h: y, x, the count and the options; the rectangle, only where the options fill or clip to it; the text padded to a word; then each character's width, where the call is given them.
  - `Escape`, 0626h: the escape, the count, then its bytes. `StartDoc` is kept as `STARTDOC`, 10, with the document's name. `SETABORTPROC` is not kept.
  - `SetDIBitsToDevice`, 0D33h: how its colours are given, then the eight words after its pointers. Then the program's DIB: its header, 40 bytes; its colours; and the lines it asked for. `StretchDIBits`, 0F43h, keeps its raster operation and how its colours are given, then its eight words after its pointers, and the whole DIB.
  - `BitBlt` and `StretchBlt` from a memory context are kept as 0940h and 0B41h: their words but the source's context, then the bitmap the source holds, whole, as a DIB. Its header gives one plane and the bits — 1 for a monochrome bitmap, 4 for the VGA's — and its image size; its colours are those `GetDIBits` gives. `BitBlt` with no source is kept as its own words, the source's nought among them. `StretchBlt` with no source answers nought and is not kept.

  The function's high byte is still the words the record holds: `Polygon` is 0324h, `ExtTextOut` 0A32h.

- **An object selected** is first made in the lowest free place of the metafile's handle table. Then `SelectObject`, 012Dh, names its place.
  - A pen is made by `CreatePenIndirect`, 02FAh, with its `LOGPEN`.
  - A brush is made by `CreateBrushIndirect`, 02FCh, with its `LOGBRUSH`. A pattern brush is made by `DIBCreatePatternBrush`, 0142h. A bitmap's pattern is 3, nought, then the bitmap as a DIB. A DIB's pattern is 5, how its colours are given, then every byte of the DIB's block as the brush copied it.
  - A font is made by `CreateFontIndirect`, 02FBh, with its `LOGFONT`, keeping its face name, its nought and two bytes more, to a word. The two bytes are whatever was in GDI's memory. A stock font is kept with its own `LOGFONT`: `SYSTEM_FONT` is 16 by 7, bold, "System".
  - A region is made by `CreateRegion`, 06FFh, with GDI's own region: four words, the second 6 and the third a stamp GDI counts its objects by; its size in bytes; its scans; the most sides a scan has; its box; then each scan, its count of sides, its top and bottom, the sides and its count again. A rectangle is one scan of two sides.
  - A palette is made by `CreatePalette`, 00F7h, with its version, count and entries, when [[fn:USER.SelectPalette]] selects it. Then `SelectPalette`, 0234h, names its place.
  - A stock object is made too: the black pen, with its width nought.
- **What selecting answers.** `SelectObject` answers the object of its kind the metafile selected before. At first that is the black pen, the white brush and the device's default font. It answers 1 for a region, and nought for a bitmap, which is not kept. Still, the bitmap's place is taken, though nothing is made there. `SelectPalette` answers 1.
- **The regions' calls.** `FillRgn`, 0228h, keeps the region's place and the brush's. `InvertRgn`, 012Ah, and `PaintRgn`, 012Bh, keep the region's. `SelectClipRgn` of a region is kept as `SelectObject` of it, and answers 1. Of none, it answers nought. `FrameRgn` answers nought and is not kept.
- **The palettes' calls.** `RealizePalette` is 0035h, of no words, and answers 1. `ResizePalette` of a palette a metafile holds adds 0139h with its new count. `SetPaletteEntries` adds nothing.
- **An object deleted** with [[fn:GDI.DeleteObject]], a call that is given no device context, is still taken out of a metafile that holds it: 01F0h with its place, which is then free. One that is the metafile's selected object of its kind is deleted all the same, but nothing is kept. Its place is never used again.
- **The end** is a record of three words.

## What a metafile's context answers

- [[fn:GDI.GetDeviceCaps]] answers 5, `DT_METAFILE`, for `TECHNOLOGY`, and nought for every other index.
- The calls that ask — the colours, the modes, the origins and extents, `GetTextExtent`, `GetTextMetrics`, `GetClipBox`, `GetPixel`, `LPtoDP` and the rest — answer nought and fill in nothing. The `Ex` forms that ask, `GetCurrentPositionEx` and its kind, give their pointer nought and nought, and answer 1.

## Its block

A metafile's handle is the global block of its bytes. [[fn:GDI.GetMetafileBits]] and [[fn:GDI.SetMetafileBits]] give the same handle back. The block is nine words longer than the metafile: [[probe:metarec]]'s metafile of 12 words is in a block of 64 bytes, and one of 54 words in 128. [[fn:GDI.CopyMetafile]] of one in memory to memory copies the whole block.

## Playing it

- `EnumMetafile` calls its procedure with each record but the last, a handle table as large as the header says, and that count.
- `PlayMetafile` does not put the device context back. The mode, the colours and the clip a metafile set are left set: played a second time, a metafile that ends in `R2_NOT` draws inverted ([[fn:GDI.SetROP2]]).
- **Each record is made by the function itself.** [[read out]] `PlayMetaFileRecord` (`GDI.EXE` seg19 `0826`) makes a call given only numbers through the function's own entry. It asks GDI for the address by its ordinal: the record's low byte, or 300 more from 2Eh on (`098b`-`0996`). It keeps the address at `DS:0187h` and four bytes on for each ordinal (`096c`-`09be`), copies the record's words onto the stack as the arguments (`13de`, then `1c4b`-`1c6b`), and calls it far (`1c6f`). The calls given a pointer are taken apart and made as a program makes them. So played on a printer driver's context, each reaches the driver as a program's call does: a colour goes through the driver's `ColorInfo`, a pen or brush through its `RealizeObject`, a figure through its `Output` and text through its `ExtTextOut` ([[topic:printer-drivers]]). Played into a metafile's context, each is kept there.
- [[measured]] [[probe:prmeta]] plays a metafile with colours, a mode, a pen and a brush, figures and text onto a PostScript page, once whole with `PlayMetafile` and once a record at a time through `EnumMetafile` and `PlayMetafileRecord`. Both pages hold the same lines, as the same calls made on the context draw them: the colours as `fC` and `pC`, the text's own colour before its string. Afterwards the context keeps the colours the metafile set.

## On disk

[[measured]] [[probe:diskmeta]] makes a metafile in a file, reads it back with [[fn:GDI.GetMetafile]], and copies it with [[fn:GDI.CopyMetafile]] to another file and to memory, and one in memory to a file.

- **The file** holds the same bytes a metafile in memory holds, its header's kind still 1.
- **The handle** of a metafile on disk is a block of 192 bytes. It holds the header with its kind 2, six bytes, and then the file's `OFSTRUCT`: its length byte, eight more than the path's; 1, for a fixed disk; no error; the file's date and time; and its path in capitals.
- [[fn:GDI.GetMetafileBits]] of one on disk answers the same handle, still of kind 2. `SetMetafileBits` of it plays as it did. [[fn:GDI.DeleteMetafile]] leaves the file.
- **A copy** to its own kind keeps the header's size. A copy from disk to memory or from memory to disk says three words more than it holds, though it holds, and writes, the same bytes.
- A metafile on disk plays as the one in memory does.

## Inside Windows

[[read out]] `GDI.EXE` seg20 keeps the records.

- A metafile's device context is an object of type 4F51h (`1cdc`). It keeps its header, its handle table and the object of each kind selected. At first those are the black pen, the white brush and `DEVICE_DEFAULT_FONT` (`1d75`-`1d9d`).
- Each drawing call checks the type of its context. Where it is a metafile's, it hands its record's function to `2596`, which finds the caller's arguments and their count on the stack. The calls given a pointer are in a table at `DS:0504h` and go to `056d`, which takes each apart (`0935` for `ExtTextOut`, `0857` for `PolyPolygon`, `0b91` for the blits, `0d30` and `10b4` for the DIBs). The rest go to `0000`, which copies the words.
- `16c8` gives an object its place, by the stamp GDI counts its objects by (`1b5e`), and makes its record: by type, a pen, a brush, a font, a palette or a region (`1755`-`1a54`). A bitmap's place is taken, and nothing made.
- A memory metafile's block grows a hundred words at a time (`1a6c`-`1b54`). [[fn:GDI.CloseMetafile]] makes it the metafile's size in words and nine more (`1e42`-`1e5c`).
- `GetDeviceCaps` answers 5 for `TECHNOLOGY` on a context of type 4F51h, and nought for the rest (seg1 `44c3`-`44cf`).
- `DeleteObject` tells each metafile that holds the object (`26a7`). Where it is that metafile's selected object of its kind, its place is marked and nothing kept; else `01F0h` is kept and the place freed.

## In winbox.js

`crates/winbox-win16/src/gdi/metafile.rs`. A GDI call whose device context is a metafile's is kept as a record where it is dispatched, not drawn. `CloseMetafile`, `PlayMetafile`, `PlayMetafileRecord` and `EnumMetafile` are made on the context as on any other. A metafile on disk is written when it is closed. To be played or copied, it is read into a block of its own. A record is played through the function a program calls, so a printer driver's context hands it to its driver, and a metafile's context keeps it. In the Rust engine (`crates/winbox-win16/src/gdi/metafile.rs`), playing waits where that function waits, and a record a driver's context draws is handed to `printer_output.rs`. A record's text is given with its address, as a program's string is, for the driver. A call into a metafile that is not kept answers nought.

## Not yet done

- `AnimatePalette` of a palette a metafile holds. [[read out]] seg20 `1441` keeps 0436h with the start and count, then as many doublewords copied from the call's own arguments, not from its entries.
- `SetPaletteEntries` and then `RealizePalette` in a metafile. [[read out]] seg20 `150a` keeps 0037h with the palette's entries first.
- Playing the records of bitmaps, DIBs, pattern brushes, palettes and escapes: winbox.js passes over them.
- A region's stamp: winbox.js keeps nought, as it counts no stamps.
- `Escape(SETABORTPROC)` on a metafile's context (seg7 `00fb`).
