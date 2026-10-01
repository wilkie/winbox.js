---
kind: topic
name: Brush dithering
summary: How a Windows 3.1 display driver draws a solid brush of a colour it lacks as a pattern of the colours it has, and how it picks the one colour a pen or GetNearestColor gets, on the VGA, Super VGA, EGA and Hercules.
probes: [dither, dither3, penmatch, brushorg, brushrlz]
---

A sixteen-colour display has sixteen colours, and a Hercules has two. A program can still ask for any of sixteen million. The display driver answers in one of two ways, depending on what the colour is for:

- A **brush** gets a pattern. It is eight pixels square and mixes colours the display has, so that the mixture looks like the colour asked for from far enough away.
- A **pen**, and the answer [[fn:GDI.GetNearestColor]] gives, gets one colour.

[[measured]] [[probe:dither]] fills a square of the screen with a solid brush and reads back every pixel. It does this for every grey in steps of four, a cube of five levels of red, green and blue, every grey, every red, and red against green in eighths. It also fills each colour into a monochrome bitmap, and asks `GetNearestColor` about each. It was recorded on all four displays. winbox.js reproduces every one of those records on all four: 2,393 on each.

## Where the pattern starts

[[measured]] The pattern is anchored to the device context's origin, not to the rectangle being filled. A square filled on the screen at (53, 37) has the same pixels as the pattern at (32, 32) would have there, so two fills side by side meet without a seam.

[[measured]] For a window, the origin is the window's own, not the screen's. [[probe:chrome]]'s scroll bar control fills its trough through the control's device context. On the Hercules, where the colour is the quarter pattern, the pattern starts at the control's corner and is one row out of step with the screen's. [[documented]] This is why a Windows 3.1 program that fills adjacent windows with a patterned brush sets the brush origin itself.

[[measured]] The origin is kept on the screen. [[probe:brushorg]] gets a device context for a window whose client area is at (101, 53). [[fn:GDI.GetBrushOrg]] answers (101, 53), and a pattern starts at the window's corner. After [[fn:GDI.SetBrushOrg]] to (0, 0), [[fn:GDI.UnrealizeObject]] and the brush selected again, the pattern starts at the screen's corner: its first pixel lands at (3, 3) in the window, where the screen's multiples of eight fall. Borland's BWCC does exactly this before it fills its dialogs with its dotted grey. winbox.js had counted the origin from the window, and put the dots one pixel out in both directions. Every `GetDC` and `BeginPaint` gives the window's corner again.

[[measured]] A brush keeps the place it was realised, though it is used again somewhere else. [[probe:brushrlz]] fills two windows, A and B, whose corners are an odd number of pixels apart, with one solid brush of 408080h, which the VGA dithers as a checker. The pattern starts at A's corner in A. Used next in B, it stays in step with A, a pixel out from B's own corner. After [[fn:GDI.UnrealizeObject]] it starts at B's corner. Used in A again, it stays in step with B. A colour the display dithers is realised as a pattern brush is, from the device context's brush origin when the brush is first selected. Chess erases its window with a brush, and answers the same brush for its labels' `WM_CTLCOLOR`, and Windows shows the labels in step with the window. [[fn:USER.DefWindowProc]] realises a class's brush as it erases. It unrealises the scroll bar's brush each time it answers it, which is why a scroll bar's pattern starts at its own corner. Chess's screen now matches Windows' pixel for pixel.

## One order for every pattern

[[measured]] Every pattern, on every display, ranks its 64 pixels in an order. The pixels lower in the order take the darker part of the mixture. The colour displays and the Hercules share this order, by y and x modulo eight:

```
 0 32  8 40  2 34 10 42
48 16 56 24 50 18 58 26
12 44  4 36 14 46  6 38
60 28 52 20 62 30 54 22
 3 35 11 43  1 33  9 41
51 19 59 27 49 17 57 25
15 47  7 39 13 45  5 37
63 31 55 23 61 29 53 21
```

[[inferred]] This is the standard 8 by 8 ordered-dither matrix. Two of its entries, 15 and 47, are hidden in the Hercules's own patterns (below). They are the only values that make the table an order of all 64.

## The sixteen-colour displays

[[measured]] On the VGA, the Super VGA and the EGA, a colour the palette holds is drawn solid. Any other colour is mixed from two cubes of colours:

- The **dark** cube, whose channels are 0 or 128.
- The **bright** cube, whose channels are 0 or 255.

The mixture is decided pixel by pixel in the order above:

1. The brightest channel decides how many pairs of pixels are bright: `(max - 127) >> 2` when it is over 128, and none otherwise. The remaining pixels are dark.
2. Each channel puts its value into the dark pixels first, at 128 a pixel, up to `(v + 1) >> 2` pairs of them.
3. Whatever is left over goes into bright pixels one at a time, each counted as 256 rather than 255, with a half rounded down: `(v - 2 * dark + 1) >> 2` of them, where `dark` counts the dark pixels.
4. In either part, a channel is on in the pixels highest in the order.

This reproduces all 981 fills on each of the three displays. [[probe:dither3]] fills a cube of seven levels a side: 16, 48, 96, 142, 176, 215 and 240. Those colours have three channels apart, between the levels `dither` sampled. It was recorded on the VGA, the Super VGA and the EGA, which draw every one of the 343 alike, and the rule reproduces all 343 on each. On the Hercules the same fills are its two-colour patterns, below, and those reproduce all 343 as well.

[[measured]] So a grey of 64 is half black and half dark grey in a checkerboard. A colour of red 0, green 64 and blue 192 is half dark cyan and half blue. A colour with green 255 and red 32 is green with an eighth of yellow.

[[refused]] Each channel dithered on its own, between 0 and 128 or between 128 and 255, is exact for every grey and every red: 512 of 512. It fails on every colour whose channels lie on both sides of 128, because Windows keeps each pixel inside one cube. Rounding the bright remainder down gives 917 of 981, and rounding it up gives 805. The bright remainder rounded to the nearest pair of pixels at 255 a pixel reproduces every `dither` fill but only 253 of `dither3`'s 343. There the bright pixels come in odd numbers, which pairs cannot give: red 142 against 40 dark pixels has 15 bright ones, not 16.

[[measured]] Tetris for Windows of the corpus fills its window with a picture OR'd with a solid brush of a colour it picks at random for each paint. One tile of Windows' screen of it matches the new rule's pattern at the window's origin, pixel for pixel, for the colours around red 104, green 44 and blue 204.

[[measured]] The EGA's own grey is `404040`, not `c0c0c0`, and it is drawn solid. It never appears in a mixture: the EGA mixes from the same two cubes as the VGA, so its `c0c0c0` is a checkerboard of `808080` and white. See [[topic:display-drivers]].

## Two colours

[[measured]] On the Hercules's screen, and in a monochrome bitmap on any display, some of the 64 pixels are white, and they are the lowest in the order. How many are white, and which counts have patterns of their own, depends on the driver:

| Driver         | White pixels in 64                  | Order           | Patterns of its own |
| -------------- | ----------------------------------- | --------------- | ------------------- |
| Hercules       | `(red + green + blue + 3) / 12`     | the table above | 16 and 48           |
| VGA, Super VGA | `(red + 2 * green + blue + 4) >> 4` | the table above | 16 and 48           |
| EGA            | `(red + 2 * green + blue + 4) >> 4` | its own, below  | 32 and 48           |

[[measured]] The patterns of their own are a quarter (every fourth pixel on a diagonal, rows `10001000` and `00100010`), a half (a checkerboard) and three quarters (every fourth pixel black). The Hercules's screen reproduces all 981 fills. `monoramp` puts every grey and every level of red, green and blue alone into a monochrome bitmap, and the formulas reproduce 1,024 of 1,024 on each display.

[[refused]] The greys in steps of four allow any rounding from 4 to 11 in the colour drivers' formula. The `monoramp` records allow only 4.

[[measured]] The EGA's order for a monochrome bitmap, by y and x modulo eight. As with the Hercules table, 31 and 47 are hidden by its own patterns and are the only values that complete it:

```
 0 32 16 48  2 34 18 50
24 56  8 40 26 58 10 42
 4 36 20 52  6 38 22 54
28 60 12 44 30 62 14 46
 3 35 19 51  1 33 17 49
27 59 11 43 25 57  9 41
 7 39 23 55  5 37 21 53
31 63 15 47 29 61 13 45
```

## One colour, for a pen

[[read out]] The colour drivers do not choose the nearest colour by distance. `ColorInfo`, the driver's export 2, and `RealizeObject` share one routine in `VGA.DRV`'s first segment, at `1956`:

1. Sort the channels largest first, remembering which comparisons swapped.
2. Sort three parts of the colour: the largest channel less the middle one, the middle less the smallest, and the smallest.
3. Whichever part is largest says whether the colour is one channel, two channels, or a grey.
4. Each of those three has a list of levels. The level nearest the largest channel wins, and the lower level wins a tie. For one channel or two, the levels are 0, 128 and 255. For a grey, they are 0, 128, 192 and 255.
5. The winning level stands for a colour's index bits, which the remembered swaps put back on red, green and blue.

[[measured]] It answers all 194 `nearest` records on each colour display. Red 192, green 128, blue 0 is two channels and nearest 255, so yellow. Adding blue 64 makes it one channel, so red. [[refused]] The nearest colour by distance in red, green and blue agrees with 149 of 194 on the VGA and 155 on the EGA.

[[read out]] The EGA's list for greys is 0, `40`, `82` and 255, standing for black, its dark grey, `808080` and white. The Hercules draws white where red, green and blue add up to 382 or more.

[[read out]] Beside each colour, the drivers keep flags. One of them says which colours a monochrome bitmap takes as white: light grey, green, yellow, magenta, cyan and white on the VGA. The EGA's dark grey, which takes light grey's place, is not one of them.

[[measured]] Everything drawn in one colour follows this routine: a pen one pixel wide or six, text, an opaque background, and `SetPixel`. [[probe:penmatch]] draws each of a cube of 512 colours, eight levels a side, into a bitmap compatible with the screen and into a monochrome one. It was recorded on all four displays. Every pixel is the colour `GetNearestColor` answers, 512 of 512 in each kind on each display. In a monochrome bitmap on the colour displays, a colour is white exactly where the flags say it is, 512 of 512. That holds on the EGA too, whose flags leave out its dark grey. On the Hercules, both its screen's bitmaps and a monochrome bitmap draw white where red, green and blue add up to 382 or more. A pen six pixels wide is solid, not a pattern. `SetPixel` answers the colour it drew, not the colour it was asked for.

[[refused]] Taking white in a monochrome bitmap only where the colour's match is white itself agrees with 310 of the 512.

## Implementation

`src/raster/dither.ts` makes each pattern as an eight-by-eight tile. `rasterOp` uses it wherever the destination is the display's own format, or monochrome. The EGA's palette is its driver's, `DevicePalette.EGA`, and every bitmap of the display's depth uses it. `src/raster/colour-match.ts` is the one-colour routine. [[fn:GDI.GetNearestColor]] answers with it, and a device bitmap's context and the screen's turn every colour drawn into an index with it, knowing the display they are drawn on.

Not yet measured: a 256-colour driver, hatched and pattern brushes, and brushes into colour bitmaps of a depth other than the display's.
