---
kind: topic
name: WinG
summary: Microsoft's 1994 library for drawing fast into device-independent bitmaps on Windows 3.1 — its device context, its bitmaps whose bits a program writes itself, its colour tables, blits and halftone palette — measured on the 256-colour display with WinG installed.
probes: [wingprof, wingapi, wingbig]
---

WinG was given away by Microsoft in 1994 for games on Windows 3.1, and was never part of Windows. A program makes a WinG device context and WinG bitmaps, and draws into a bitmap's bits itself, through a pointer WinG gives it. Then it blits the bitmap to its window. SimTower draws this way. Without WinG, Windows stops SimTower at "Cannot find WING.DLL".

The oracle installs WinG with its own Setup, on the 256-colour display ([[topic:palettes]]): Microsoft's Super VGA driver on the ET4000 that DOSBox emulates. Setup copies `WING.DLL`, `WINGDE.DLL`, `WINGDIB.DRV`, `WINGPAL.WND`, `WING32.DLL` and `DVA.386` into `SYSTEM`, and adds `device=C:\WINDOWS\SYSTEM\dva.386` to `[386Enh]`. The first time a program asks WinG for its recommended format, WinG times the display for minutes, with a box saying so, and keeps what it found in `WIN.INI`'s `[WinG]`. The oracle runs WinG once after Setup, so a program starts as it would on a machine that had run one before.

winbox.js answers for `WING.DLL` itself, with no file of it on the disk. The probes find WING.DLL by name and its functions by ordinal: 1001 to 1010.

[[read out]] A program may find them by name instead, with [[fn:KERNEL.GetProcAddress]], as Lode Runner: The Legend Returns does ([[topic:win386]]). `WING.DLL`'s table of names it does not keep resident (the one its header's 2Ch points to) names them `WINGCREATEDC` (1001), `WINGRECOMMENDDIBFORMAT` (1002), `WINGCREATEBITMAP` (1003), `WINGGETDIBPOINTER` (1004), `WINGGETDIBCOLORTABLE` (1005), `WINGSETDIBCOLORTABLE` (1006), `WINGCREATEHALFTONEPALETTE` (1007), `WINGCREATEHALFTONEBRUSH` (1008), `WINGSTRETCHBLT` (1009) and `WINGBITBLT` (1010). WinBox named 1002 `WinGRecommendedDIBFormat`, so `GetProcAddress` of `WinGRecommendDIBFormat` answered nought, and the game called through it to 0000:0000; it is named as WinG names it now (`wings_calls_are_named_as_wing_dll_names_them`). The table also has `WINGINITIALIZETHUNK16` (1500), `WINGTHUNK16` (1501), `REGISTERWINGPAL` (2000) and `EXCEPTIONHANDLER` (2001), which WinBox does not have.

## The recommended format and the device context

- [[measured]] `WinGRecommendDIBFormat` (1002) answers 1, and a header of 40 bytes, 1 by 1, one plane, 8 bits a pixel, uncompressed. The height of 1 is above nought, so the recommended DIB is bottom-up. [[probe:wingprof]].
- [[measured]] `WinGCreateDC` (1001) makes a device context of WinG's own DIB driver. Its [[fn:GDI.GetDeviceCaps]] answers 24 bits a pixel, one plane, `NUMCOLORS` 16 and `RASTERCAPS` `EE99h`. The bitmap it starts with is 1 by 1. [[probe:wingapi]].

## Bitmaps

- [[measured]] `WinGCreateBitmap` (1003) makes a bitmap of the header's size, and answers a pointer to its bits. [[fn:GDI.GetObject]] answers its width and height, its bytes a row, a whole number of double words, one plane and 8 bits. `WinGGetDIBPointer` (1004) answers the same pointer, and fills in the header as it was given.
- [[measured]] What the program writes through the pointer is the picture, with no call between. With a height above nought, the bits' first row is the picture's bottom. With a height below nought, it is the top.
- [[measured]] [[fn:GDI.GetPixel]] of a WinG device context answers the colour table's own colour for each index, `5f3f3f` as it is, and black for an index past the table's end.
- [[measured]] A bitmap of more than 64 KiB is one block behind one pointer. [[probe:wingbig]] makes one of 640 by 480 and writes it through a huge pointer, a row at a time. Every row is where its place in memory says, either side of each 64 KiB boundary.
- [[measured]] `WinGSetDIBColorTable` (1006) and `WinGGetDIBColorTable` (1005) work on the bitmap selected into the device context, and answer how many entries they took. A pixel read after the change is in the new colour.

## Blits and the halftone palette

- [[measured]] `WinGBitBlt` (1010) and `WinGStretchBlt` (1009) copy to the screen. With no palette realized, each colour of the table comes out as the nearest static colour, as any colour does on that display: `123456` is navy. `WinGStretchBlt` at twice the size doubles each pixel.
- [[measured]] An entry of the colour table that is the system palette's colour at its own index is copied as that index, not matched to a colour: [[probe:wingfade]] realizes a palette whose 236 entries between the static colours are `PC_RESERVED` and black, makes the bitmap's colour table the palette's entries (black, as the system palette's are), blits pixels of indices 10 to 245, and they show black; `AnimatePalette` then gives the 236 entries colours, and the pixels show those colours. A table of the colours while the palette is black is matched to the nearest colours, the static ones, and they stay as matched after the animation; a table that is the system palette's but for entry 245, made white, keeps every other index and puts white where 245 was. Lode Runner: The Legend Returns draws each picture so and fades it in ([[topic:win386]]). winbox.js matched every entry to its nearest colour, the first of equals, so black went to index 0 and the game's pictures after its first stayed black.
- [[measured]] In the same probe, each palette after the first takes the handle of the one deleted before it, and `RealizePalette` answers 256 for each. [[read out]] `DeleteObject` of the palette realized last makes it so no longer (`GDI.EXE` seg1 `19f4`-`1a13`: `[482h]` cleared), as `UnrealizeObject` of it or of GDI's foreground palette does (seg1 `27f2`-`282f`); winbox.js kept it, and answered 0 for the new palette, realizing nothing. The probe is recorded in standard mode: under the recorder, 386 enhanced mode on the 256-colour display gave no output in 300 seconds, twice.
- [[measured]] GDI's own `BitBlt` and `StretchBlt` from one WinG bitmap into another match each colour to the nearest in the destination's table, the first of equals, wherever in the table it is: not to the static colours, as onto the screen. An index past the source's table comes out as 0. Catz draws its pictures into its playpen's bitmap this way.
- [[measured]] `WinGCreateHalftonePalette` (1007) makes a palette of 256 entries. The twenty static colours are at either end, with flags 0. Between them are WinG's own colours: a run of greys, then levels of red, green and blue over `00`, `33`, `66`, `99`, `cc` and `ff`, each `PC_NOCOLLAPSE`.
- `WinGCreateHalftoneBrush` (1008) is recorded for three colours and the three dither types, but not followed: winbox.js makes no brush.

## In winbox.js

`crates/winbox-win16/src/wing.rs`. A WinG bitmap is an 8-bit device bitmap whose palette is the DIB's colour table. Each 64 KiB tile of its bits is a segment whose bytes are the bitmap's pixels, the rows in the header's order, so the program's writes and GDI's drawing are the same pixels. Built-in modules once had entry code only for ordinals under 1000. WinG's are 1001 to 1010, so a call to one ran into noughts, and SimTower stopped there.

How long WinG's calls take on the 256-colour display, and a blit's time by its size, are in [[topic:timing]].
