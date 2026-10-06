---
kind: topic
name: GDI's objects in memory
summary: Where Windows 3.1's GDI keeps a bitmap — its handle a local handle in GDI's heap, its object tagged KO, and the display driver's header and planes in global memory — measured by walking there as a game engine does to draw into the bits itself, and how winbox.js makes those bytes when read.
probes: [gdiobj, gdinum, stockdel]
---

A program is given handles to GDI's objects and nothing more. Some go looking anyway. Bubble Girl of the corpus brings an engine, `KNPS.DLL`, that draws into its bitmaps' bits itself, the way games did before WinG:
- It asks TOOLHELP's [[fn:TOOLHELP.SystemHeapInfo]] for GDI's data segment, and reads the bitmap's object there by its handle.
- It follows a handle from the object to the display driver's header for the bitmap, and a far pointer from there to the bits.
- It checks what it finds: the object's type, that the pointer can be read, and that the height is the one it asked for.

If the checks fail, it falls back on the DIB driver, which the installation does not have, and the game ends on "Not enough memory".

[[measured]] [[probe:gdiobj]] makes the same walk under Windows, on the VGA, for bitmaps compatible with the screen of 20 by 3, 33 by 2, 320 by 220, 704 by 480 (Bubble Girl's) and 16 by 1 to 4.

## The handle and the object

- A bitmap's handle is a moveable local handle in GDI's heap: the word at it is the object's address, and the next two bytes are nought.
- The object's word at +2 is `KO`, 4F4Bh. The engine accepts 5 too, which may be another version's.
- At +0Ah is a moveable global handle. [[fn:KERNEL.GlobalLock]] of it gives its selector at offset nought.

## The handles' numbers

[[measured]] [[probe:gdinum]] asks where GDI's handles fall, on the VGA, the Super VGA, the EGA and the Hercules.

- The stock objects' handles are the same on all four displays. They run from `WHITE_BRUSH` at ACEh, four apart in their indices' order, to `DEVICE_DEFAULT_FONT` at AFEh. After that comes `SYSTEM_FIXED_FONT` at B02h, then `DEFAULT_PALETTE` at B06h.
- Index 9, which nothing documents, is an object too, at AEAh. [[fn:GDI.GetObject]] answers it as a pen of 10 bytes: `PS_NULL`, nought wide, white.
- Pens, brushes, fonts, regions, bitmaps, palettes and memory device contexts share one set of handles. A new object is given the handle given back last, whatever kind it was. With a brush and then a font deleted, the next brush has the font's handle and the next pen the brush's. A region takes a deleted pen's, and a pen a deleted memory context's.
- [[fn:USER.GetDC]] of the desktop, released and asked for again, answers the same context. A second held at the same time is another. They come from a few contexts kept aside, well below where the probe's objects went.
- Otherwise new handles go down four at a time while the heap's free handles run that way. On the VGA, a pen, a brush, a pen, a font, a region and a bitmap had handles four apart. A memory device context took two, and the palette after it came eight below. Where they start, and where they jump, is not reproducible. It depends on everything GDI's heap has held since Windows started. On the Hercules the free handles already had gaps before the probe began, and on the EGA a memory context took four. A font made after two deletions skipped two handles on the VGA, for reasons not found. So only the rules above are held to.

## Stock objects

[[read out]] The object's word at +2 is its kind, from 4F47h for a pen to 4F50h for a metafile. Two of its bits are flags, which every kind check masks off. GDI sets 8000h in each stock object as it makes them at start-up (`GDI.EXE` 2:02AE, 2:0331). [[fn:GDI.MakeObjectPrivate]] sets or clears 2000h (1:0E68). [[fn:GDI.DeleteObject]] answers 1 for an object with either flag set, and does nothing else (1:194C). [[measured]] [[probe:stockdel]] deletes every stock object, twice, and each one survives with its handle. The same holds for the stock bitmap, the one every memory device context starts with. An object deleted while it is selected into a device context is deleted all the same, and the context keeps its handle.

## The driver's header

The global block starts with 20h bytes of the display driver's header:

| offset | what | 20 by 3 | 704 by 480 |
|---|---|---|---|
| 0 | nought | 0 | 0 |
| 2 | width | 14h | 2C0h |
| 4 | height | 3 | 1E0h |
| 6 | bytes of a plane's row, rounded to a word | 4 | 58h |
| 8 | planes (a byte) | 4 | 4 |
| 9 | bits a pixel (a byte) | 1 | 1 |
| 0Ah | far pointer to the bits | the block, at 20h | a block of their own, at 0 |
| 0Eh | bytes of a plane, a row's by the height (a double word) | 0Ch | A500h |
| 16h | step from one of the bits' selectors to the next | 0 | 8 |
| 18h | rows that fit in 64 KiB | 1000h | BAh |
| 1Ah | bytes left after them | 0 | 40h |

- The pointer to the bits is nought until the bitmap is first selected into a device context.
- When the bits fit in 64 KiB after the header, they follow it in the same block. The block is then at least a byte more, rounded to 32: 60h for 20 by 3 and 89C0h for 320 by 220. Bitmaps 16 wide and 1 to 4 high bound the extra: at least 1 and at most 8. Every size is the same for any of those, since the header and the bits are always a multiple of eight.
- Otherwise the block is the header alone, 20h, and the bits are a block of their own. For 704 by 480 that is 29480h: two segments of 64 KiB, and the last segment's rows.

## The bits

- Each row is the four planes' rows in turn. A pixel's colour is the index its four bits make, in the driver's palette, where dark grey is 7 and light grey is 8.
- Rows do not cross from one segment to the next. Each segment holds as many whole rows as fit, from its start: row 185 of 704 by 480 is at 0:FE60h, 186 at the next segment's 0, 371 at its FE60h and 372 at the third's 0.
- The bits past each row's last pixel are whatever the memory held. The probe masks them.
- A byte written straight into the bits is what [[fn:GDI.GetPixel]] then answers.

## In winbox.js

winbox.js keeps GDI's objects, and a bitmap's pixels, in itself. Copying them into the program's memory as they change would cost every program for the sake of a few. Instead, the segments a program would find them in make their bytes when they are read:

- `SplitBlock` in `src/emulator/split-block.ts` lets a 64 KiB segment's bytes come from a handler, which makes them when read and takes them when written. Only the 1 MiB block of memory holding such a segment does more work.
- GDI's data segment is `GdiHeap` in `src/win16/gdi/gdi-heap.ts`. A read at a bitmap's handle answers its entry, and objects are given addresses above the handles, from 4000h, as they are first looked up. The object's type and the handle at +0Ah follow.
- The header's block, and the bits' block where they have their own, are ordinary moveable global blocks, made when the handle at +0Ah is first read, and plain memory, which the program reads and writes as it likes. winbox.js keeps the bitmap's pixels in itself too, so the two are made to agree around a call that names the bitmap, or a device context it is selected into: the pixels read from the bits before it, and the bits and the header's fields written from the pixels after. The bits past the bitmap's width are left as they were. Bubble Girl draws into its bits about two million times a run and names the bitmap to GDI about three hundred; when each of those bytes went through a handler instead, it was most of the run's time.
- Deleting the bitmap lets its blocks go.

Not recorded, and read as noughts: other kinds of object, the object's other fields, and the header's double word at 12h. Nor where Windows puts objects in its heap. Only four-plane bitmaps are laid out, as the VGA's and the EGA's are; nothing on the eight-bit displays has been recorded. What a program writes to GDI's heap itself is lost. The handles are one set for every kind of object, as GDI's are: 4 apart with their low bits 2, the stock objects at Windows' own, and a handle given back given out again first (`HandleManager.gdiHandle`). New ones go down from C6Ah, where the VGA's first new object was, past the stock objects, and then above where they started. Screen device contexts keep numbers of their own.

With these, the pointer checks and growing blocks past 64 KiB ([[topic:global-and-local-memory]]), and the 386 its engine is written for ([[topic:the-processor]]), Bubble Girl runs, its title screen as Windows draws it.
