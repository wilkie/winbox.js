---
kind: topic
name: Maximize, minimize, move and size
summary: What Windows 3.1 does to a window it maximizes, minimizes, restores, moves and sizes — where it puts it, what it draws, and the standard icons — measured on four displays and replayed through the exports.
probes: [sizing, icons]
---

A window in Windows 3.1 is normal, maximized or minimized, and `DefWindowProc` moves it between these states when the user clicks a caption box or picks the system menu's commands. [[measured]] [[probe:sizing]] takes one ordinary window, the size and place of [[probe:chrome]]'s, through each state. At each step it records the window's rectangle and its client area's, [[fn:USER.IsIconic]] and [[fn:USER.IsZoomed]], and it reads back the screen maximized and minimized. [[probe:icons]] records the standard icons drawn, and what a window whose class has no icon shows when it is minimized. Both were recorded on the VGA, the Super VGA, the EGA and the Hercules, and winbox.js agrees with every record of both on all four displays.

## Maximized

- [[measured]] A maximized window's rectangle is the screen made larger by the sizing frame on every side: from `(-SM_CXFRAME, -SM_CYFRAME)` to `(width + SM_CXFRAME, height + SM_CYFRAME)`. The frame lies off the screen, and the caption starts at the screen's top row.
- [[measured]] The maximize box becomes the display driver's `OBM_RESTORE` bitmap. Everything else in the frame is drawn as for a normal window ([[topic:window-frames]]).
- [[measured]] Restoring puts the window back where it was, at the same size. `IsZoomed` is true only while it is maximized.

## Minimized

- [[measured]] A minimized window is an icon window, `SM_CXICON + 4` by `SM_CYICON + 4`: 36 by 36 on every display recorded. It has no frame, caption or client area of its own that shows. The icon is drawn two pixels in from its corner, over the desktop beneath it.
- [[measured]] The first icon goes at `x = (SM_CXICONSPACING - SM_CXICON) / 2`, rounded down, which is 21, and `y = height - SM_CYICONSPACING`. That is 408 on the VGA, 284 on the EGA and 282 on the Hercules.
- [[measured]] `SM_CXICONSPACING` is 75 on every display. `SM_CYICONSPACING` is 72 on the VGA and the Super VGA, and 66 on the EGA and the Hercules. [[fn:USER.SystemParametersInfo]] gives the same with `SPI_ICONHORIZONTALSPACING` and `SPI_ICONVERTICALSPACING`, and `SPI_GETICONTITLEWRAP` is 1.
- [[measured]] The icon's **title** is a window of its own, directly below the icon and centred on it. It is as wide as its text plus two pixels each side, and as tall as the title font's cell. The text starts one pixel in. An active window's title is in `COLOR_CAPTIONTEXT` on `COLOR_ACTIVECAPTION`.
- [[measured]] The title font is what `SPI_GETICONTITLELOGFONT` returns: MS Sans Serif, weight 400, and a height of `-round(8 × LOGPIXELSY / 72)`, which is −11 on the VGA and −8 on the EGA and the Hercules.
- [[measured]] A window whose class names `IDI_APPLICATION` for its icon shows USER's own icon group 32647 when it is minimized, not the driver's `IDI_APPLICATION`. That is the Windows flag. A window whose class has no icon is not drawn by USER at all: it is erased with its class's background and painted like any other window, so [[probe:icons]]'s bare window shows as a white square.
- Not yet measured: where the second and later icons go. winbox.js puts each in the next free slot along the bottom row, `SM_CXICONSPACING` apart. That fits the first slot, but no probe has minimized two windows yet. Also not measured: titles too long to fit, which `SPI_GETICONTITLEWRAP` says are wrapped, and how an inactive icon's title looks.

## The standard icons

- [[measured]] `LoadIcon(NULL, ...)` succeeds for `IDI_APPLICATION`, `IDI_HAND`, `IDI_QUESTION`, `IDI_EXCLAMATION` and `IDI_ASTERISK`. The icons are the display driver's own resources.
- [[measured]] The driver's `IDI_APPLICATION` group holds one 64 by 64 monochrome icon, and [[fn:USER.DrawIcon]] draws it at 32 by 32. The pixel drawn at `d` is the source pixel at `floor((d × 64 + 32) / 32)`, the centre of each pair, so the odd rows and columns show. Sampling the even ones leaves the bottom border wrong. Any offset from 32 to 63 also fits the recording.
- [[measured]] `DrawIcon` ANDs the screen with the icon's mask and then XORs in its picture, on the display's palette indices.

## An icon is a block of memory

- [[read out]] An icon handle is a global memory handle (`USER.EXE` seg12 `0000`, `01bb`; seg13 `1029`). The block starts with a header of words: the hotspot's x and y, the width and height, and the mask's bytes a row, a whole number of words. Then a byte of planes and a byte of bits a pixel. The AND mask follows, a bit a pixel, the top row first. After it comes the picture, each row's planes in turn, each plane's row a whole number of words.
- [[read out]] `LoadIcon` writes the icon into a new block in the display's own format: four planes of a bit a pixel on the VGA, the EGA and the Super VGA, and one on the Hercules. `CreateIcon` copies the bits it is given, in the format it is told, which nothing checks against the display's (seg12 `0110`). `CopyIcon` makes a new block (`0260`), and `DestroyIcon` frees it (`0170`).
- [[read out]] `DrawIcon` reads the block each time it draws, and draws it at `SM_CXICON` (seg13 `0199`). A program may write into the block, and Program Manager does: it copies each item's icon from its group file into one icon's block, then draws it. Plane `p` of a pixel is bit `p` of its colour index. That is from data, not code: every icon in the installation's group files decodes this way to the same picture as the program's own resource.
- Not yet measured: an icon handle's value, `GlobalSize` of one, and `CreateIcon` given a format that is not the display's.

## Moved and sized

- [[measured]] Moving and sizing are modal, like a menu ([[topic:menus]]): `DefWindowProc` runs its own loop for `SC_MOVE` and `SC_SIZE` until Enter, Escape or the mouse button's release. From the keyboard, each arrow moves the window by half of `SM_CXSIZE` across or `SM_CYSIZE` down. That is 9 pixels across on every display, and 9 down on the VGA and the Super VGA but 8 on the EGA and the Hercules.
- [[measured]] When sizing from the keyboard, the first arrow picks the edge that moves and does not move it. The arrows after it move that edge. So [[probe:sizing]]'s three rights and two downs size its window 18 wider and 9 taller (8 on the EGA and the Hercules). The same keys move it 27 across and 18 down (16 on the EGA and the Hercules).
- [[documented]] With the mouse, a drag on the caption moves the window, and a drag on the sizing frame sizes it by that edge. A drag within the frame's notches sizes it by the corner. A double click on the caption maximizes the window or restores it.
- Not yet measured: the outline drawn while the window moves. Windows' move and size loop does not dispatch a timer, so the probe cannot capture from inside it. The first version of [[probe:sizing]] waited there for one and never finished. winbox.js draws the window's rectangle inverted, a sizing frame's width thick, and that is its own choice. The least size a window can be dragged to follows `SM_CXMINTRACK` and `SM_CYMINTRACK`, which is also unrecorded. A pressed caption box is not measured either.

## Implementation

`Desktop` in `src/win16/user/desktop.ts` has `maximize`, `minimize` and `restore`, and it paints icons and their titles. `showRaster` in `src/win16/user/window-state.ts` is `ShowWindow` on the raster desktop, and it sends `WM_SIZE` and `WM_MOVE` when a window changes. `trackWindow` in `src/win16/user/track-loop.ts` is the move and size loop. Icons are read by `src/raster/icon.ts` and `src/win16/user/driver-resources.ts`, from the user's own display driver and `USER.EXE`, and are never shipped.

`test/raster/sizing_test.ts` holds the maximized and minimized captures on all four displays. The conformance suite replays both probes through the exports: `ShowWindow`, `SendMessage` of `WM_SYSCOMMAND` with the keys posted first, `GetWindowRect`, `IsIconic`, `IsZoomed`, `LoadIcon`, `DrawIcon`, `SystemParametersInfo` and [[fn:GDI.GetPixel]] on the screen.
