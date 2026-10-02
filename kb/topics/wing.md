---
kind: topic
name: WinG
summary: Microsoft's 1994 library for drawing fast into device-independent bitmaps on Windows 3.1 — its device context, its bitmaps whose bits a program writes itself, its colour tables, blits and halftone palette — measured on the 256-colour display with WinG installed.
probes: [wingprof, wingapi, wingbig]
---

WinG was given away by Microsoft in 1994 for games on Windows 3.1, and was never part of Windows. A program makes a WinG device context and WinG bitmaps, and draws into a bitmap's bits itself, through a pointer WinG gives it. Then it blits the bitmap to its window. SimTower draws this way. Without WinG, Windows stops SimTower at "Cannot find WING.DLL".

The oracle installs WinG with its own Setup, on the 256-colour display ([[topic:palettes]]): Microsoft's Super VGA driver on the ET4000 that DOSBox emulates. Setup copies `WING.DLL`, `WINGDE.DLL`, `WINGDIB.DRV`, `WINGPAL.WND`, `WING32.DLL` and `DVA.386` into `SYSTEM`, and adds `device=C:\WINDOWS\SYSTEM\dva.386` to `[386Enh]`. The first time a program asks WinG for its recommended format, WinG times the display for minutes, with a box saying so, and keeps what it found in `WIN.INI`'s `[WinG]`. The oracle runs WinG once after Setup, so a program starts as it would on a machine that had run one before.

winbox.js answers for `WING.DLL` itself, with no file of it on the disk. The probes find WING.DLL by name and its functions by ordinal: 1001 to 1010.

## The recommended format and the device context

- [[measured]] `WinGRecommendedDIBFormat` (1002) answers 1, and a header of 40 bytes, 1 by 1, one plane, 8 bits a pixel, uncompressed. The height of 1 is above nought, so the recommended DIB is bottom-up. [[probe:wingprof]].
- [[measured]] `WinGCreateDC` (1001) makes a device context of WinG's own DIB driver. Its [[fn:GDI.GetDeviceCaps]] answers 24 bits a pixel, one plane, `NUMCOLORS` 16 and `RASTERCAPS` `EE99h`. The bitmap it starts with is 1 by 1. [[probe:wingapi]].

## Bitmaps

- [[measured]] `WinGCreateBitmap` (1003) makes a bitmap of the header's size, and answers a pointer to its bits. [[fn:GDI.GetObject]] answers its width and height, its bytes a row, a whole number of double words, one plane and 8 bits. `WinGGetDIBPointer` (1004) answers the same pointer, and fills in the header as it was given.
- [[measured]] What the program writes through the pointer is the picture, with no call between. With a height above nought, the bits' first row is the picture's bottom. With a height below nought, it is the top.
- [[measured]] [[fn:GDI.GetPixel]] of a WinG device context answers the colour table's own colour for each index, `5f3f3f` as it is, and black for an index past the table's end.
- [[measured]] A bitmap of more than 64 KiB is one block behind one pointer. [[probe:wingbig]] makes one of 640 by 480 and writes it through a huge pointer, a row at a time. Every row is where its place in memory says, either side of each 64 KiB boundary.
- [[measured]] `WinGSetDIBColorTable` (1006) and `WinGGetDIBColorTable` (1005) work on the bitmap selected into the device context, and answer how many entries they took. A pixel read after the change is in the new colour.

## Blits and the halftone palette

- [[measured]] `WinGBitBlt` (1010) and `WinGStretchBlt` (1009) copy to the screen. With no palette realized, each colour of the table comes out as the nearest static colour, as any colour does on that display: `123456` is navy. `WinGStretchBlt` at twice the size doubles each pixel.
- [[measured]] `WinGCreateHalftonePalette` (1007) makes a palette of 256 entries. The twenty static colours are at either end, with flags 0. Between them are WinG's own colours: a run of greys, then levels of red, green and blue over `00`, `33`, `66`, `99`, `cc` and `ff`, each `PC_NOCOLLAPSE`.
- `WinGCreateHalftoneBrush` (1008) is recorded for three colours and the three dither types, but not followed: winbox.js makes no brush.

## In winbox.js

`src/win16/wing.ts`. A WinG bitmap is an 8-bit device bitmap whose palette is the DIB's colour table. Each 64 KiB tile of its bits is a segment whose bytes are the bitmap's pixels, the rows in the header's order, so the program's writes and GDI's drawing are the same pixels. Built-in modules once had entry code only for ordinals under 1000. WinG's are 1001 to 1010, so a call to one ran into noughts, and SimTower stopped there.

How long WinG's calls take on the 256-colour display, and a blit's time by its size, are in [[topic:timing]].
